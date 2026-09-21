# Slice 5 — export, diagnostics and recovery: development record

Date: 21 September 2026. Plan and acceptance: [agentic product specification](2026-09-21-agentic-product-spec.md) §4 slice 5 and §5.
Agent: Claude Code (`claude-opus-5`, effort `xhigh`, ultracode orchestration: one read-only
planner, four editors with disjoint files, one independent reviewer, one fix round). The
contract is `.omx/artifacts/slice5-native-20260921/plan.json`. Nothing here is a production,
novelty or scientific-validity claim.

## Objective, preserve, acceptance

- **Objective.** The replay archive carries, beside the mission's request, state and
  runtime, the release decision with its verification receipt, the evidence graph, the
  claim cards, the timeline and the grants with their receipts, and verifies alongside
  the earlier format; a figure's PNG is downloadable only when the release ledger allows
  export, while the inline preview keeps serving; Diagnostics reads storage integrity,
  failed renders with a retry, renderer, package and probe facts on demand, each with its
  source, and produces a redacted report; the service knows whether the desktop window
  started it and Diagnostics says so.
- **Preserve.** Format-2 archives verify byte for byte on the new verifier and the
  `verify` route still exports format 2 for its receipt; ledger gating; `/health`'s
  public fields and the `X-Arc-Science-Service` header; the redaction rules of the
  startup log; the Diagnostics tests of slices 1–2; the slice-3 guard and slice-4 hooks.
- **Acceptance** (from the specification): export of a verified mission has the new
  members and verifies; tampering the timeline fails the manifest but not numeric
  reproduction; a blocked mission's PNG download is refused; Diagnostics shows ownership,
  storage and renderer facts with sources.

## Changes

- **Capsule (Python).** `export_capsule(request, state, *, release=None, claims=None,
  timeline=None, grants=None)`: with no keywords the format-2 path is byte-identical to
  HEAD; with all four the archive is `arc-research-capsule/3` with `release.json`,
  `evidence_graph.json` (derived from the state inside the export), `claims.json`,
  `timeline.json` and `grants.json`, all covered by the manifest. `verify_capsule`
  accepts either member set, keeps every existing check, and treats the five new members
  as follows: a digest mismatch on any of them is recorded in `manifest_failures` (which
  sets `integrity: false`) and never touches `reproduction_passed` or `reproduced`;
  `release.json` must parse as a release decision; `evidence_graph.json` must equal the
  graph derived from `state.json`; `claims.json`, `grants.json` and `timeline.json` are
  informational (the limitations say so) and must be JSON. A format-2 set claiming
  format 3 or the reverse is refused with the existing message. The report gains
  `format`, `members`, `informational` and `manifest_failures`.
- **Service.** `GET /api/missions/{mid}/capsule` exports format 3 (release from the same
  decision that gates the export, claims from `build_claims`, the timeline rows, the
  grants and receipts); `POST /verify` keeps exporting format 2 for its receipt.
  `GET /api/missions/{mid}/artifacts/{digest}/download` serves the PNG as an attachment
  (`arc-<mid>-<digest12>.png`, same bytes and ETag as the inline route) only when the
  chain verifies and the release ledger allows export; otherwise 409 with the same
  sentence as the capsule route. `/health` gains `host_session: {mode: owned |
  standalone, source: ARC_HOST_SESSION}` (read at request time; `owned` only when the
  variable says so). `diagnostics.py` (new): `GET /api/diagnostics` with five sections
  — storage (event-chain verification of the newest 200 missions with the broken ids
  named, `PRAGMA integrity_check` of `missions.db`, `grants.db` and `timeline.db`, memory
  capture status), jobs (failed or interrupted molecular renders with `retryable` and a
  note), renderer (Blender Python and the SVG rasterizer from the environment, the
  runtime probe if one already ran, the newest render), package (version, Python,
  supervisor, settings revision, data directory, start time) and probes (the last record
  per transport) — each with `source`, `checked_at`, a readiness state, a code, a
  meaning and a next action; local reads only, nothing started. `GET
  /api/diagnostics/report` returns a text document (`arc-diagnostics-report/1`) with
  `/health`, a readiness summary and the reading, redacted with the startup log's rules
  plus the operator token, the native session secret and the home path (`~`); the
  envelope's own sentence describes the redaction. `POST
  /api/molecular/renders/{id}/retry` resubmits a failed or interrupted render from its
  recorded settings and stored coordinates as a new job (409 without settings, without a
  renderer, or when the coordinates changed; 404 when they are gone). Readiness'
  storage next action now points at `Read diagnostics`.
- **Desktop (Rust).** `startup.rs` sets `ARC_HOST_SESSION=owned` only in the
  environment of the service process the window starts (the supervisor passes its
  environment through to the Python worker); the reuse path spawns nothing and sets
  nothing; the desktop's own process never carries it. Tests: the marker reaches only the
  owned child (the ignored fixture prints it); the reuse tests are unchanged. README: one
  sentence. The service cannot observe a reused service, so the page derives "reused
  (started elsewhere)" from an `owned` service seen without a desktop session — a
  deviation from the spec row's "unknown", accepted by the reviewer as the honest word.
- **Web.** Diagnostics: the Service card shows `Host session` (`owned by this window` /
  `reused (started elsewhere)` / `standalone (not started by the desktop app)` / not
  read / not reported) with a `Source: /health …` note and `data-host-session`; a new
  section `Storage, renders and package (read on demand)` with `Read diagnostics` and
  `Copy redacted report`, five cards (Storage integrity, Failed renders with `Retry
  render` per job, Renderer facts, Package, Probes) each ending with `Source: … Read at
  …`, the report shown in a read-only textarea and copied to the clipboard when the
  browser allows it, and the sentence that opening the startup log from this page is
  not available in this build (the host allows that action only on its startup failure
  page — a slice-6 gate); nothing new is fetched on mount. Research: `Download PNG` is a
  button that requests the gated route and hands the bytes to the download handler; a
  refusal shows `Download refused: …` and keeps the image; the blocked sentence stays.

## Checks (per kind of evidence)

- Mocked: pytest 885 passed / 65 skipped on the final tree (`ARC_SVG2PNG` set):
  `test_release_contract.py` 16 (format-2 members and byte-identity, format-3 members,
  informational tampering with replay untouched, core tampering refused, format
  mismatch refused, a re-hashed evidence graph named, incomplete keywords refused),
  `test_diagnostics.py` 7 (fresh directory, a broken chain named and nothing else
  blocked, a mission that cannot be verified named while the others are still checked,
  failed renders with retry facts, sqlite missing and unreadable stores, the redaction
  function, the report free of token, secret and home path), `test_service.py` (host
  session, the nine-member export, the PNG gate before and after verification),
  `test_molecular_jobs.py` (retry as a new job, 409 on a completed job, 404 unknown);
  Vitest 13 files, 171 tests (host session table, read on click with every card's source
  and no startup-log button, retry with the 409 detail, copy and the fallback, locked
  without a session, Download PNG as a button); cargo fmt clean, clippy clean, 40 tests
  passed / 2 ignored (the marker reaches only the owned child; the desktop process does
  not carry it; reuse spawns nothing).
- Browser service: Playwright 31/31 (the 700 px Diagnostics test now counts seven
  buttons; `/api/diagnostics` and the report with no token, no bearer value and no user
  path; `/health` standalone; the repaired-figure test with four Download PNG buttons).
- Reviewer's black-box run (`review-and-editors.json`): a completed and verified demo
  mission exported nine members with format 3, release `eligible_for_human_review` and
  a receipt, twelve timeline rows; tampered timeline and grants → `integrity: false`
  naming the members while `reproduction_passed` stayed true; tampered `state.json` →
  `Artifact checksum mismatch`; a format-2 archive exported by a worktree of 3dadcc5 is
  byte-equal to the new code's format-2 export and verifies on the new verifier, and the
  old verifier refuses the format-3 archive; inline PNG 200 while `/download` is 409
  before verification and an attachment with the same bytes and ETag after; `/health`
  standalone by default, owned with the variable, standalone with any other value;
  diagnostics on a fresh directory, a broken chain in a copy of the data directory, a
  failed render fixture retryable with the retry answering the documented 409 on this
  machine (no Blender); the report free of the token, bearer values and the home path;
  the UI against those services; on `arc-science-desktop.exe` launched on its own
  workspace the Service card read `owned by this window` and a browser tab against the
  same service read `reused (started elsewhere)`; every process stopped and no listener
  left.
- Native binary (`arc-science-desktop.exe` SHA-256
  `F2D41E3CFAED54CFFD472AEB04C925B87331402FA4C4E8C3C220BB6CC75DBB08`, 4,603,904 bytes,
  built from this tree; run directly because the operator's own instance on port 8080
  holds `Arc Science.exe` open — the launcher's copy of the binary was not refreshed and
  the operator's instance was not touched), workspace `arc-slice5-fresh` on port 8090,
  Playwright over the diagnostic attach (`msedgewebview2.exe <- arc-science-desktop.exe`),
  `.omx/artifacts/slice5-native-20260921/report.json`, captures D01–D03, E01–E03b, the
  downloaded files and `uia-download.log`:
  - **D, Diagnostics**: the Service card read `Host session owned by this window ·
    Source: /health host_session.mode = owned; this page holds the desktop session.`
    (`data-host-session=owned`); `Read diagnostics` filled the five cards — Storage
    integrity `Ready` (`missions.db ok · grants.db ok · timeline.db ok`, memory capture
    ready), Failed renders `Not tested` (no render recorded), Renderer facts `Blocked`
    (no Blender Python; SVG rasterizer `arc-svg2png.exe` found), Package (version 0.6.0,
    Python 3.11.9, supervisor path), Probes — each ending with its source and read time;
    no `Open startup log` button and the sentence explaining why; `Copy redacted report`
    copied the report to the clipboard (WebView2 allowed it) and showed it in the
    textarea: `arc-diagnostics-report/1`, `host_session.mode: owned`, no home path, no
    bearer value.
  - **E, Research**: a demo mission (round limit 2) finished with two figures, no
    `Download PNG` button and the blocked sentence twice, Export disabled; `Replay and
    verify` made the release `Eligible for human review`, two `Download PNG` buttons and
    Export enabled. A CDP-driven click on `Download PNG` produced no download and no
    notice (a WebView download needs a user gesture the attach does not provide, as in
    the earlier slices' download driver), so both controls were activated through UI
    Automation: `Saved arc-<mid>-d6aef18c95db.png in C:\Users\…\Downloads` (20,592
    bytes whose SHA-256 is the artifact digest) and `Saved arc-<mid>.zip in …` (56,184
    bytes). Both files were moved into the evidence folder; the archive verified from
    disk: nine members, format 3, integrity true, reproduction passed, 3 computations
    and 2 artifacts reproduced, 11 timeline rows, 3 claims; the same archive with
    `timeline.json` replaced and the manifest kept → integrity false naming
    `timeline.json`, reproduction still passed. From the page's own session, a second,
    unverified mission's PNG was served inline (200) and refused by the download route
    (409 `Release blocked; verify the mission and resolve: replay_integrity:unknown, …`).
  - The instance was closed at the end; no process of that workspace remained and
    port 8090 was released. Nothing left this machine.
- Found on the real binary and fixed in this slice: the readiness Storage card still
  said integrity checking was "not in this build" beside the new control (copy updated
  in readiness and its tests); the Storage integrity row read `0 of 0 (newest 200 of
  0)` on an empty store (the qualifier now appears only when the check was bounded).

## Independent review

- Reviewer (separate Claude context; whole diff, all suites including cargo, the
  black-box run and the native check): **reject** on one blocking finding — the
  repaired-figure e2e test still looked for `Download PNG` links after the slice turned
  them into buttons (fixed in the fix round, one line) — and two minor findings applied
  by the orchestrator: the report's own redaction sentence was being rewritten by the
  bearer rule (the envelope is now added after redaction), and one mission that could
  not be verified aborted the storage loop (now named and the loop goes on, with a
  test). Review and editor reports:
  `.omx/artifacts/slice5-native-20260921/review-and-editors.json`.
- Sol (GPT-5.6): blocked by the Codex usage limit until 25 September.

## Requirement states after this slice

| ID | State | Evidence |
| --- | --- | --- |
| A8 | partly verified | package facts, storage integrity, failure paths (broken chain, missing store, failed render, refused download) and the redacted report on the real binary and in the black-box run; performance measurements and a clean-profile package check remain (slice 6) |
| J6 | partly verified | export of a verified mission with the release, evidence graph, claims, timeline and grants members, verified from disk after a real download; informational tampering fails the manifest and not the replay; a stale or unverified check blocks the PNG download and the export; replay with limitations intact |
| J7 | extended | Diagnostics agrees with `/health` on the host session and names the source of every fact |
| J8 | extended | the report carries neither token, bearer value, native secret nor home path; the download route refuses without a verified chain |
| A7 | extended | Diagnostics and export journeys on the rebuilt binary at desktop size |
| G (diagnostics) | partly verified | same vocabulary as readiness; retry per render, copy report; opening the startup log from the page is a named slice-6 gate |

## Remaining gates

- `Arc Science.exe` (the launcher's copy) is still the slice-2 build while the operator's
  instance holds it; copy `arc-science-desktop.exe` over it once that window is closed.
- Opening the startup log from the Diagnostics page (host scheme gated to the failure
  page; slice 6).
- A retry of a failed render that completes (needs a configured Blender Python).
- The service cannot distinguish a reused service; the page's derived word stands until
  the desktop can hand the service a session identity.
- Narrow-size captures of the new Diagnostics section; the CDP attach cannot exercise a
  download, so the UIA driver stays the native path for downloads (slice 6 versions it).
