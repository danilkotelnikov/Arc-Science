# Slice 4 — cockpit and claims: development record

Date: 21 September 2026. Plan and acceptance: [agentic product specification](2026-09-21-agentic-product-spec.md) §3 decision 5, §4 slice 4 and §5.
Agent: Claude Code (`claude-opus-5`, effort `xhigh`, ultracode orchestration: one read-only
planner, three editors with disjoint files, one independent reviewer). The contract the
editors implemented is `.omx/artifacts/slice4-native-20260921/plan.json`. Nothing here is a
production, novelty or scientific-validity claim; the timeline is an operational record and
the claim cards are a derivation from persisted records.

## Objective, preserve, acceptance

- **Objective.** Every operation of a mission (each planner, reviewer and falsifier call,
  each tool dispatch, each visual review, the stop, and the operator's start, resume, pause
  and cancel, and the service's own interruption) leaves timed rows in an append-only
  table the UI shows as a timeline; an operation the service never finished reads "no
  outcome recorded", derived at read time and never stored. The operator can pause a
  running mission, retry an errored one as a declared change with a reason, and cancel
  with the actor and time recorded. Reopening the workbench reselects the last mission
  from the browser profile (the id only). Claim cards show, per requested claim, the
  supported scope, evidence with method and digest and the time it was obtained,
  independence of the two reviewing roles, findings, alternatives and conflicts, next
  tests, units, and whether the derivation is stale under the current rule. Release
  checks read in the shared words (passed / failed / unverified / blocked / stale / n/a).
- **Preserve.** The `Event` model and its dumps (change declarations bind to a digest of
  them; the mission hash chain must keep verifying); the engine's reservation and commit
  order; `MissionCancelled` / `RevisionConflict` semantics; artifact and export gating;
  the slice-3 guard region of the worker (receipts unchanged); demo missions need no grant;
  the existing release rule (`claim_scope` reads `stale` when the derivation version
  differs; any stale check blocks export).
- **Acceptance** (from the specification): an offline mission yields timeline rows for
  planner, tools, reconciliation and stop with ordered times; killing the service
  mid-mission leaves the mission paused with `mission_interrupted` and the in-flight row
  `outcome_unknown`; reopening reselects the same mission; claim card fields present; a
  stale check blocks export.

## Changes

- **Timeline (Python).** `exploration/timeline.py` (new): `MissionTimeline` over
  `timeline.db` beside `missions.db` and `grants.db` (owner-only, WAL), one `timeline`
  table with a `started` row and a `finished` row per operation (`op` id, unique per
  phase), `BEFORE UPDATE` / `BEFORE DELETE` triggers, vocabularies for operation
  (`plan | tool | reconcile | visual_review | stop | start | resume | pause | cancel |
  interrupt`), role, source (`worker | operator | service`) and outcome; `start()`,
  `finish()` (refuses an unknown outcome, `outcome_unknown`, or a second finish),
  `record()` for instantaneous operator and service rows, `rows()` merging the two
  phases (no finished row → `outcome_unknown`, `outcome_source: derived`,
  `finished_at: null`). A `CURRENT_OP` context variable lets the slice-3 guard attach
  its receipt id to the row of the call it guarded. The mission hash chain is untouched,
  so every earlier mission still verifies; a mission from before this slice reads
  `recorded: false` (no reconstruction from events, per decision 5).
- **Engine and repository.** `explore(..., log=None)` gains hook lines only: a started
  row before and a finished row after the planner call (a reused committed plan is a
  `reused` row without a call), each tool dispatch, the visual review, each
  reconciliation role and the stop; no change to state, reservations, commit order or
  error handling. `repository.pause(mid, actor, at)` appends `mission_paused` and sets
  the status through the same revision fence as `save` (the worker's next commit is
  refused and the route cancels its task, as cancel does); `cancel(mid, actor, at)`
  appends `mission_cancelled` with `Cancelled by <actor> at <time>; late results
  fenced.` (the stop reason unchanged); `pause_interrupted()` returns the ids it paused.
  `evidence.py`: the successor rule now also accepts `mission_paused` as a stop and
  `mission_cancelled` after a stop, an interruption or a pause; every history accepted
  before is still accepted.
- **Service.** `GET /api/missions/{mid}/timeline` (`kind: operational`, `recorded`,
  `rows`, a note that the record is not evidence); `GET /api/missions/{mid}/claims`; the
  worker's `log` callback writes the rows, links receipts through `CURRENT_OP` (the
  three `ledger.receipt(...)` calls of the guard are wrapped in `note(...)`, nothing else
  in that region changed), and records the transport of each seat from the bound route;
  a worker failure records a timed `stop` row with the redacted reason (the
  connector-fails-at-start observation of the slice-3 record now has a row); the
  lifespan writes an `interrupt` row for each mission `pause_interrupted()` paused;
  `schedule()` records the operator's `start` / `resume` row with the actor
  (`operator:token` or `operator:native`, from the auth dependency); `POST
  /api/missions/{mid}/pause` (409 when not running, 409 `Mission changed; retry pause`
  on a concurrent commit); `POST /changes` also resumes a mission in `error` and then
  requires a non-blank note (409 `A retry from an error states its reason in the note`);
  `POST /start` still refuses `error`.
- **Claims (Python).** `exploration/claims.py` (new, pure): `build_claims(state,
  timeline_rows, graph, release)` → per `ScopedBranch` of the persisted claim scope:
  requested wording, status, supported scope and uncertainties verbatim; evidence per
  observation with `method = tool@tool_version`, the observation digest, whether it
  counts for the scope, the source kind, the numeric summary from the tool's own fields,
  and `started_at` / `finished_at` / `receipt_id` from the last recorded `tool` row for
  that action (else `time_source: none`); independence from the two roles' recorded
  identities (two roles, two distinct model identities and no recorded reason; one
  identity behind both roles is never independent); findings; alternatives (parents,
  children, siblings, conflicts from the evidence graph or `unavailable`); next tests;
  `units: null` with the note that no tool in this build reports a unit;
  `stale_derivation` and `claim_scope_check` from the release decision's `claim_scope`
  check. Nothing here is validation, and the module says so in its `note`.
- **Web.** Mission view: an interruption or pause banner from the last persisted event; a
  `Route` card from the `seats_bound` event and the mission's grants (offline: "no route
  was bound and no grant exists"); the `Timeline` table (sequence, started, finished,
  operation, role, requested → observed model, identity, tool/action, branch, outcome,
  receipt, actor/detail; `outcome_unknown` reads `no outcome recorded`; "running" comes
  only from the persisted status) in a horizontal scroller; claim cards inside the Claim
  scope section with the rows Requested claim · Evidence-supported scope · Remaining
  uncertainty · Evidence · Independence · Findings · Alternatives · Next discriminating
  test · Units · Derivation (`data-stale`), falling back to the persisted scope view when
  the claims read fails; buttons enabled by the persisted status only: Start, `Resume
  (recorded as an analysis and claim change)`, Pause, `Retry after error` with a reason
  field (note `Retry after error: <reason>`), Cancel; an accepted start, resume or retry
  keeps the mission polled for up to 30 s until its status leaves paused or error (a
  live worker connects its connectors before its first commit); the side sections
  (grants, timeline, claims) land before the mission row so the poll that sees the stop
  also shows the cards. Reopen: `localStorage['arc.research.mission']` holds the id
  only, written on select and on create; restored once per page load when the session
  is unlocked, never on a keystroke (a manual token counts once it has settled by Tab,
  Enter or a click elsewhere, or has been accepted by a protected read; the desktop
  session needs no settling); the restore is not a busy task, so the click that settled
  the token is not lost; a 404 drops the key and says so.

## Checks (per kind of evidence)

- Mocked: pytest 865 passed / 65 skipped on the final tree (`ARC_SVG2PNG` set),
  including `test_timeline.py` (15: the demo sequence and its order, append-only refusals,
  the hard-kill reconstruction with the chain still verifying, pause with the late save
  refused, cancel actor/time, retry from error, a legacy mission with no timeline, the
  receipt linkage of a live plan row with `identity_verified` and the denied outcome
  after revocation, the successor rule) and `test_claims.py` (8: the demo state, the
  timeline lookup, the stale rule with `assert_exportable` raising, an unavailable graph,
  determinism, no scope yet, a live-shaped state with `unverified_identity`, source
  kinds); Vitest 13 files, 166 tests (timeline rows and attributes, pause and retry
  gating, banners, route card, reopen on a settled token only, claim cards and the stale
  marker, the fallback view, unshaped answers, the final poll landing its cards, an
  accepted resume polled until running).
- Browser service: Playwright 30/30 (12 timeline rows in order after a demo mission, all
  recorded, the start row's actor; reload → nothing restored before the token, nothing
  requested while it is typed, restored on Tab with only the id in storage and the token
  in no request URL; the ten claim-card rows; the earlier cancel and resume journeys).
- Reviewer's black-box run against `python -m arc_science serve` (R1–R10 of the contract,
  all passed; `review-and-editors.json`): a real kill of the service during a planner
  call and a restart on the same data directory → paused, `mission_interrupted`, the plan
  row `outcome_unknown` / derived, an `interrupt` row from the service, no `ok` receipt;
  pause during a call → 200 with the event text, a second pause 409, the late answer
  refused, resume 202 with pause and resume rows and the later plan row carrying the
  observed model, `identity_verified` and a receipt id; cancel with actor/time on a ready
  mission and on the paused-after-kill one (`/evidence` still valid); retry: garbage
  planner → error, `/changes` without a note 409, `/start` 409, with a note 202 and the
  change note recorded; stale blocks export: verify, resume to completion → four checks
  `stale`, `GET /capsule` 409 naming `:stale`, Export disabled; legacy: a worktree of
  5be3383 ran a demo and an interrupted live mission, the new build read `recorded:
  false`, verified the chain, served claims with `time_source none`, and resumed the
  paused legacy mission with rows from the resume on; `UPDATE` / `DELETE` on
  `timeline.db` refused, the file and its WAL free of the token, the goal and tool
  arguments; localStorage holds only the mission id; the guard region diff limited to the
  three `note(...)` wrappers and the transports line.
- Native EXE (`Arc Science.exe` SHA-256
  `243718F3581A65BC2E6D21F1DF2793A3A51FC58CB5C405EAFBFD4ED2298E31E0`, unchanged: this
  slice touched no Rust), workspace `arc-slice4-fresh` on port 8090 (the operator's own
  instance on 8080 was left alone), Playwright over the diagnostic attach
  (`msedgewebview2.exe <- Arc Science.exe`), `.omx/artifacts/slice4-native-20260921/report.json`
  and captures A01–A04, B01–B04, C01–C04:
  - **A, offline mission** (round limit 3, desktop session): the timeline read 12
    recorded rows in order — start (`operator:native`), plan, tool, reconcile ×2, plan,
    tool ×2, reconcile ×2, plan, stop `completed` — with times and `scripted-fixture-v1`
    on the seat rows; the Route card read the offline sentence; three claim cards with
    all ten rows (quadratic: evidence `fit-quadratic · polynomial_fit@arc-numeric-2 ·
    digest … · ok · started 20:47:40 · receipt none · validation MSE …`, `Independent
    reviewers: no` with both roles `scripted-fixture-v1 · identity not recorded`,
    alternatives `parents linear; siblings null-control`, derivation `arc-claim-scope-3 ·
    release check claim scope: passed`); the release decision read `passed` /
    `unverified` in the shared words; after a page reload the same mission was reselected
    from `arc.research.mission` with its 12 rows.
  - **B, service exit mid-mission** (live mode on the local stand-in planner, 25 s per
    call, and the fake MCP server; route approved as in slice 3): with the plan row in
    flight (`no outcome recorded`), the service process was stopped with
    `Stop-Process -Force`; the page read `Arc Science is not reachable. Start the local
    service, then retry.` (B02). The window was closed, the EXE relaunched on the same
    workspace, and Research showed the same mission reselected, `paused`, with the banner
    `Interrupted: the service exited while this mission was running (persisted event
    mission_interrupted, round 0) …`, the plan row `no outcome recorded` and an
    `interrupt` row from the service; Pause disabled, Resume and Cancel enabled, no
    Retry (B03). Resume ran the mission to completion: resume (operator:native), plan
    with `claude-opus-5 → claude-opus-5` and identity verified, tool, reconcile ×2, …,
    stop `completed` (B04); the grants showed the seat used 8 times and the connector 2.
  - **C, pause by the operator**: on a fresh live mission, Pause during the first plan
    call → `paused`, banner `Paused: Paused by operator:native at 2026-09-21T18:01:13Z;
    resume explicitly. Resume continues it as a declared change.`, rows plan (`no outcome
    recorded`) and pause (`operator:native`), Pause disabled (C01); Resume → `running`
    with a resume row and a new plan row (C02); the mission then completed (C03) with
    one claim card (`echo · Unassessed`, untested) (C04).
  - The isolated instance was closed at the end; no `Arc Science` / `arc-science-native`
    process of that workspace remained and port 8090 was released. Nothing scientific
    left this machine: the stand-in CLI and the fake server are local processes.
- **Found only on the real EXE and fixed in this slice** (the archived runs are in
  `run1-final-poll-dropped/`, `run2-old-bundle/`, `run3-journey-order/`,
  `run4-partB-mission-finished-before-kill/`, `B03b-*`, `B03c-*`):
  1. the poll that saw the mission stop aborted its own side reads, so the claim cards
     (which exist only after the stop) and the last timeline rows were not shown until
     the mission was reselected — the side sections now land before the mission row, and
     a Vitest case with delayed answers fails on the old order;
  2. after Resume on the interrupted mission the service accepted the start (202) and ran
     the mission to completion, but the view stayed `paused` because the row read right
     after the 202 still said paused (a live worker connects its connectors before its
     first commit) and a paused mission is not polled — an accepted start, resume or retry
     is now polled for up to 30 s; the e2e-driven browser suite had not caught this since
     its missions are offline fixtures.
  3. after the restore was gated on a settled token, the Load-missions e2e test lost its
     click: the restore ran as a busy task and disabled the button between mousedown and
     click — the restore is no longer a busy task.
  4. the twelve-column timeline wrapped its headers into fragments at 1280 CSS px; it
     now scrolls horizontally with headers on one line.

## Independent review

- Reviewer (separate Claude context; whole diff, suites and the black-box run):
  **accept** with two minor findings, both applied by the orchestrator: the reopen effect
  attempted a protected read on every keystroke of a typed token (now gated on a settled
  or accepted token, with tests in Vitest and e2e), and `independent` read true for a
  branch both roles had challenged under one model identity (now requires two distinct
  identities; the C1 test pins the demo `linear` branch as not independent). Review and
  editor reports: `.omx/artifacts/slice4-native-20260921/review-and-editors.json`.
- Sol (GPT-5.6): blocked by the Codex usage limit until 25 September.

## Requirement states after this slice

| ID | State | Evidence |
| --- | --- | --- |
| A5 | verified for this build | timeline from persisted rows across a real service exit and a window relaunch (native B), pause and retry, actor and time on cancel (pytest, reviewer); no invented telemetry: `outcome_unknown` is derived, "running" only from the status |
| A6 | partly verified | claim cards carry requested vs supported scope, evidence ids with method and digest, retrieval time from the timeline, independence, findings, alternatives and conflicts, next tests, units (none recorded) and the stale marker; numeric uncertainty is the tools' own MSE fields with a note that no interval is computed; provenance beyond digest and identity (source quality grades) remains open |
| J5 | partly verified | offline fixture mission natively with steps, tools and branches; a consented live mission on the local stand-in only (the operator's account not used); cancel in e2e, pause/resume/reopen natively; persisted rows equal the UI by construction (the UI renders the route's rows) |
| J6 | partly verified | stale checks block export (reviewer R6: verify, resume, `GET /capsule` 409 `:stale`, Export disabled); support/contradiction and hashes on the cards; export and replay with limitations intact are slice 5 |
| J7 | extended | reopen restores the selection; Memory's "Open mission" link deferred (needs main.jsx) |
| A7 | extended | native journeys at 1280 CSS px for setup, mission, interruption, pause and claim review; narrow-size captures for this slice not taken |

## Remaining gates

- Memory workspace "Open mission" link (needs main.jsx and a Research prop).
- Narrow-size (700 px) captures of the timeline and claim cards on the EXE.
- Capsule format 3 with timeline and grants members (slice 5); `/api/diagnostics`.
- A live mission on the operator's own account (needs the operator's credential or CLI
  login).
- Units and numeric uncertainty beyond the tools' own fields need a tool that reports
  them; none in this build does.
