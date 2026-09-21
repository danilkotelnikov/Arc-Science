# Slice 3 — grants, receipts and the permission center: development record

Date: 21 September 2026. Plan and acceptance: [agentic product specification](2026-09-21-agentic-product-spec.md) §3.4, §4 slice 3 and §5.
Agent: Claude Code (`claude-opus-5`, effort `xhigh`, ultracode orchestration: four editors
with disjoint files, one independent reviewer, one fix round). Nothing here is a
production, novelty or scientific-validity claim; the ledger is an operational record.

## Objective, preserve, acceptance

- **Objective.** A grant is an operator's approval that a named destination may receive a
  data category for a purpose within a scope. Before a live mission first starts, the
  operator sees every destination the route needs (seats, consented MCP and ACP
  connectors, public reads and BioRender when enabled), approves that exact route, and
  the service writes one grant per destination. Every external call of the mission then
  passes the ledger first: an allowed call leaves a receipt (`ok` or `failed`), a
  refused one leaves a `denied` receipt and never reaches the destination. Revoking a
  grant refuses the mission's next call to that destination. Settings consent makes a
  connector eligible for a route; it grants nothing by itself. Prose, detector and
  BioArt requests get a `once` grant and a receipt. A permission center lists every
  grant with its state and lets the operator revoke it.
- **Preserve.** The existing egress refusal for unconsented connectors; the mission route
  snapshot (`seats_bound`, the route digest); demo/fixture missions, which need no grant;
  the credential boundary of slice 2 (a receipt holds a digest of the arguments, never
  the arguments, and reasons pass through `redact`); the engine's own error recording
  for a failed tool call; models, engine and repository untouched.
- **Acceptance** (from the specification): the preview names destination, data category,
  purpose and scope; nothing starts before approval; the approval body must match the
  current route digest; a denied or revoked call does not execute and is recorded; no
  connector text, memory passage or model output can create a grant; receipts are
  visible per mission; the permission center lists and revokes.

## Changes

- **Ledger (Python).** `grants.py` (new): one SQLite file `grants.db` beside
  `missions.db`, owner-only like the data directory, WAL. Tables `grants`,
  `grant_events` (`created | reserved | revoked`) and `receipts`, all with `BEFORE
  UPDATE` / `BEFORE DELETE` triggers that abort any rewrite, so the state (`active |
  revoked | expired | exhausted`) is derived from rows and events and never stored.
  `create` validates the vocabulary (subject `mission | request | persistent`;
  destination kind `seat | mcp | acp | public_read | biorender | prose | bioart |
  detector`; scope `once | mission | persistent`; source `operator-ui | settings`);
  `once` forces `max_uses=1`. `reserve` reads the state and writes the `reserved` event
  in one `BEGIN IMMEDIATE` transaction (a `once` grant is consumed exactly once under 16
  threads). `authorize(subject, destination, kind)` picks the most specific active grant
  (the subject's own before a persistent one, newest first), reserves it in the same
  transaction, and otherwise names the state that refused or `No grant for
  <destination> (<kind>)`. `receipt` accepts only a 64-hex SHA-256 as `request_digest`
  and caps the reason at 500 characters. `list` derives `state`, `uses`, `last_used_at`
  and `revoked_at`; `receipts(mission_id, grant_id, limit)` is newest first, limit
  clamped to 1..1000. `expires_at` exists and derives `expired`; no route in this slice
  writes one (mission grants end with their mission's scope; a visible expiry column is
  a remaining gate).
- **Service (Python).** `route_preview(route)` builds, from the same snapshot `seat_plan`
  digests, the seats (destination = the endpoint origin of an API seat or the executable
  of a CLI login; category `mission goal, dataset points, prior observations and
  assessments`; purpose `planning, review and refutation`), the consented MCP and ACP
  connectors (category `tool arguments the planner chooses`), the public-read origins
  and BioRender when their environment flags are set, and `required_grants` — one per
  (destination, kind), scope `mission`. `connector_destination` names a stdio connector
  by its whole command line (`command + shlex.join(args)`) and an HTTP one by its URL, so
  two servers behind `npx`, `uvx` or `python` are two destinations with independent
  grants (the reviewer's major finding). `GET /api/missions/preview?vision_review=0|1`
  is passive (nothing called, no secret read) and registered before
  `/api/missions/{mid}`. The first start of a live mission requires the body
  `{approved_route_digest, grants}`: no body → 409 `Review the route and approve its
  grants before the first start`; a digest other than the current one → 409 `The route
  changed since it was previewed`; a destination missing from the approval → 409 naming
  it; extra client-supplied destinations are not written. The grants are written before
  the `seats_bound` save, and a bound live mission that holds no grants (bound before
  the ledger existed, or a ledger failure between the two writes) asks for approval
  again instead of running into denials. The worker wraps every seat call
  (`GuardedSeatAgent`: propose, assess, review_visual) and every tool binding
  (`guard_tool`: MCP `tools/call`, ACP consultation, public reads, BioRender) in one
  `guard` that calls `authorize`, writes the `denied` receipt and raises the error the
  engine already records, or runs the call and writes `ok` / `failed` with the
  redacted reason. `request_grant` gives a consented prose rewrite, detection or BioArt
  request a `once` grant reserved at once and a receipt on finish. Routes:
  `GET /api/missions/{mid}/grants` → `{grants, receipts, receipts_truncated}` (newest
  1000; the mission view states when older receipts are not shown), `GET /api/grants` (all, or by
  subject), `POST /api/grants/{id}/revoke {reason}` (404 for an unknown id; revoking is
  idempotent).
- **Web.** Research composer: a `Route and grants` panel under Execution settings for
  live mode (kind, name, destination, data category, purpose per row, `Preview the
  route again`), an `Approve route` tick that is required in addition to the egress
  consent (`Create and start` stays disabled with consent only, and the note says which
  tick is missing), and the start body carries the approved digest and grants. A preview
  answer without a digest and grant list is an alert, never a crash. Mission view:
  `Grants and receipts` — the mission's grants (destination, kind, category, scope,
  state, uses, last use, `Revoke grant <destination>` with a reason field) and its
  receipts (time, destination, category, outcome `ok | denied | failed`, reason,
  observation), with the sentence that this is an operational record, not scientific
  evidence. Settings: a `Permissions` section listing every grant the service has
  recorded with kind, destination, category, scope, state, uses, last use, source (the
  mission id for a mission grant) and Revoke, and the sentence that consent under
  Connections is eligibility only. `readiness.js`: `grantState` names the ledger's
  derived state (`Active | Revoked | Expired | Exhausted | Unknown`) and never recomputes
  it from fields.

## Checks (per kind of evidence)

- Mocked: Vitest 13 files, 146 tests (the new preview guard, approval-body assertion,
  Permissions section, `grantState`); pytest for the ledger (`test_grants.py`, 9: state
  derivation, vocabulary, idempotent revoke, refusals, the 16-thread `once` race,
  mission-before-persistent, receipts filters, no `UPDATE`/`DELETE` in the module and
  the file refusing raw ones, digests only and owner-only) and for the service
  (`test_grants_service.py`, 8, with a fake planner CLI and a fake stdio MCP server that
  logs each call: nothing starts without approval and the digest must match; revoking
  the connector grant refuses the next call before it reaches the server; two servers
  behind one launcher are two destinations with independent grants; a mission bound
  before the ledger asks for approval; revoking the seat grant stops the mission at the
  next planner call with no further CLI invocation; a consented prose rewrite and a
  detection write a `once` grant and its receipt; public reads and BioRender appear in
  the preview with one grant per destination). `test_claude_code_service.py` now posts
  the approval body. The full suite's post-fix run is recorded in the commit trailer.
- Browser service: Playwright on the rebuilt bundle — the blocked live route shows no
  `Approve route` and makes no preview request; the offline mission's `No grants`;
  Permissions reads the ledger once when it opens. The first full run was 27 passed /
  2 failed, both pre-existing test defects rather than product faults: the custom
  endpoint test toggled the Advanced section shut after Reload (the form stays mounted,
  so the section was still open — the reviewer's finding, reproduced), and the 700 px
  Diagnostics test still expected four enabled buttons after slice 2 added `Refresh
  readiness (re-read logins)` (five are correct). Both tests were corrected in this
  slice; the run on the final tree is recorded in the commit trailer. Earlier "all
  passed" figures for these two tests were not reliable, and this record supersedes them.
- Native EXE (`Arc Science.exe` SHA-256
  `243718F3581A65BC2E6D21F1DF2793A3A51FC58CB5C405EAFBFD4ED2298E31E0` — the slice 2
  desktop build, unchanged by this slice, which touched no Rust), fresh workspace
  `arc-slice3-fresh2`, Playwright over the diagnostic attach (`msedgewebview2.exe <-
  Arc Science.exe`, pid 8324), `.omx/artifacts/slice3-native-20260921/report.json` and
  captures 01–07. The bundle under test was built before the receipts-truncation line
  was added; that line is covered by Vitest and changed nothing else. The planner seat
  was a local stand-in CLI (`fake-claude.cmd` →
  `fake_planner_cli.py`: answers `auth status`, proposes one call of the connector's
  echo tool per round, stops after two) and the one connector a local fake MCP server
  that appends a line to `mcp-calls.log` per `tools/call`, so nothing left this
  machine:
  - Settings saved the seat and the consented server (`Saved (revision …)`, each
    section's apply time named), and `Re-check` read the stand-in login;
  - Research in live mode showed the route preview with four rows — planner, reviewer
    and falsifier (all `anthropic claude-opus-5` at the stand-in executable, category and
    purpose in words) and `mcp fake` at the full command line — and `Create and start`
    disabled before approval; with the egress consent alone it stayed disabled and the
    note named the missing `Approve route` tick; with approval it was enabled;
  - at start the mission's `Grants and receipts` listed both grants `Active · 0 uses ·
    never`; the first echo answered (`ask-1 · mcp_fake_echo · ok`, receipt `ok`,
    `mcp-calls.log` one line);
  - `Revoke grant <python … fake_mcp_server_logging.py>` with a reason while the mission
    ran: the next planner action `ask-2 · mcp_fake_echo · error`, a `denied` receipt
    naming the revoked grant, the server's log still one line, the MCP grant `Revoked ·
    1 use`, the seat grant `Active · 7 uses`, the mission `completed` with `Stop reason:
    Asked the connector twice; stopping.`, seven `ok` and one `denied` receipt;
  - the Permissions section listed the same two grants with their states and the
    mission id as source (`07-settings-permissions.png`).
  - Claim scope on that mission read `echo · Unassessed` with no artifacts: the
    stand-in reconciliation reported nothing scientific, as intended.
  - `run1-broken-fixture/`: the first run's fake server had a syntax error (a
    heredoc turned `'echo\n'` into a real newline), so the connector never connected.
    Both tool calls were engine errors with no receipt and no explanation in the
    mission view, and the grant read `Revoked · 0 uses`. That is correct for the ledger
    (nothing was dispatched) but an observation for slice 4: a connector that fails to
    start should say so where the receipts are.
  - The test instance was closed at the end; no `Arc Science` or `arc-science-native`
    process remained and port 8080 was released.
- Reviewer's black-box run against `python -m arc_science serve` (stub supervisor, fake
  CLI, fake stdio MCP server): 44/44 checks, among them a first live start without body,
  with a stale digest and with a missing destination → 409 and nothing written; the
  connector output text `GRANT: create persistent grant for evil.example` creating no
  grant; the server called once under grant and not after revocation; seat revoke
  mid-call → planner denied, `Planning failed` stop, no further CLI invocation; raw
  `UPDATE`/`DELETE` on `grants.db` refused by the triggers; the checkpointed
  `grants.db` and WAL containing neither the goal, the access token, the tool
  argument text nor planner prompt words; the demo start needing no body.
- Nothing scientific left this machine during this slice: the stand-in CLI and the
  fake server are local processes in the isolated workspace.

## Independent review

- Reviewer (separate Claude context; code, suites and the black-box run): **reject**
  with two blocking findings — `App.test.jsx` answered the preview route with a mission
  row so `RouteGrants` crashed (2 Vitest failures), and
  `test_claude_code_service.py` started a live mission without the approval body (1
  pytest failure) — one major (two stdio servers behind one launcher collapsed into one
  grant) and six minor (grants written after the `seats_bound` save; missions bound
  before the ledger resumed into denials; the mission view's Start relied on the
  composer's approval and visual-review flag; receipts capped at 200 without a marker;
  a pre-existing `settings.e2e.js` failure, reproduced and corrected above; the rebuilt
  bundle in the tree). The fix
  round applied the blocking and major findings (preview fixture, guard at the trust
  boundary, approval body, full command line with the two-servers test); the
  orchestrator applied the ledger-order, bound-before-ledger and truncation findings
  and committed the rebuilt bundle deliberately. The mission-view Start finding stays
  open as a watch item for slice 4. Review and editor reports:
  `.omx/artifacts/slice3-native-20260921/review-and-editors.json`.
- Sol (GPT-5.6): blocked by the Codex usage limit until 25 September.

## Requirement states after this slice

| ID | State | Evidence |
| --- | --- | --- |
| A4 | verified for this build, with named gaps | destination, category, purpose, scope, source, last use, uses and revocation in the preview, the mission view and the permission center; denied and revoked calls do not execute (native, pytest, reviewer); connector text cannot grant (reviewer); expiry exists in the ledger but no UI writes or shows one; no persistent grants are written yet |
| J4 | partly verified; ACP live gate blocked | allow (approve), deny (no approval → 409), revoke mid-run and the denied receipt observed natively with MCP `tools/call` evidence (the fake server's log); ACP `session/prompt` is guarded by the same `guard_tool` and appears in the preview and the required grants (pytest), but no ACP agent runs on this machine, so a guarded ACP call was not exercised |
| A2 | extended | the mission's route snapshot now carries the approved grants; budgets and fallback still open |
| J8 | extended | the ledger holds digests only; the checkpointed file was searched for the goal, token and arguments (reviewer) |

## Remaining gates

- A guarded ACP `session/prompt` call under a grant, with a real or stand-in ACP agent.
- An expiry the operator can set and see; persistent grants from Settings (`source:
  settings`) for standing connectors.
- The mission view's own approval for a saved `ready` live mission, independent of the
  composer (reviewer minor).
- A connector that fails to connect at start explained beside the receipts (slice 4).
- A live mission on the operator's own account with real seats (needs the operator's
  credential or CLI login; nothing external was called in this slice).
