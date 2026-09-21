# Design, copy, icons and Playwright-from-the-EXE — development record

Date: 20–21 September 2026. Plan: [design/copy/native-Playwright plan](2026-09-20-design-copy-native-playwright-plan.md).
Inventory: [visible strings and controls](2026-09-20-ui-inventory.md). This record separates what
was changed from what was observed and from what an independent reviewer accepted.

## Changes

- **Design system.** `styles.css` now carries one token set (type 11/12/13/15/20 px,
  three ink levels, lines, surfaces, one accent, ok/warn/danger with soft and line
  variants, radii, spacing) and every rule reads from it; no visible text is below
  11 px; secondary buttons have a border and disabled ones 50 % opacity so the two
  states no longer share a surface; focus rings use the accent. The navigation rail
  is sticky (tools stay reachable on a long page) and collapses to a wrapping bar at
  ≤ 760 px. Settings is one column (status bar with Reload/Save above full-width
  sections) so the seats table shows role, provider, model, effort, sign-in,
  credential and readiness together at 1280 px and scrolls inside its section at 700 px.
- **Icons.** One Lucide outline family at 18 px / stroke 1.75 in the navigation:
  search (Research), database (Memory), atom (Molecules), image (BioArt), pilcrow
  (Prose), sliders-horizontal (Settings), activity (Diagnostics); the previous shared
  `scan-search` (BioArt and Diagnostics), the dense vertical `sliders` and `pen-line`
  are gone. Geometry retrieved from lucide-static 0.560.0 and recorded in
  `docs/arc-science/supericons-manifest.json` and `THIRD_PARTY_NOTICES.md`.
- **Copy.** One session voice (`SESSION_COPY` / `sessionState` in `http.js`, rendered
  by the shared `LockNotice`): a missing token, a rejected token and an unreachable
  service each read the same way in every workspace, the rejected state in an error
  tone; the header token field carries its help as a hidden description instead of a
  CLI line. Per surface the inventory's proposals were applied by separate editors
  under one rule set (caveats kept in meaning and said once; terms defined at use;
  errors next to the failed action; disabled controls with an adjacent reason; enums
  with spaces; counts pluralised), and the critique's corrections were applied where
  an editor had over-reached: the measurement-points shape, live-mode consent, the
  data-directory argument, the probe count, the seats the transports table covers,
  the preset effects. Research shows the release decision as a chip beside the
  mission status and defines the current state in the ledger; Settings names three
  sign-in kinds (CLI login, API credential, and provider OAuth as not available in
  this build), lists only the transport's valid efforts, and says after a save what
  applied now and what waits for a restart.
- **Native host.** `ARC_DESKTOP_DIAGNOSTIC_ATTACH=1` opens the WebView2 DevTools
  protocol on an ephemeral loopback port in a dedicated profile, publishes the
  record only once the listener answers, shows the mode in the window title and
  the startup log, and removes the record on close; startup and failure copy
  rewritten (first line of the reason as the alert, bounded tail, "Open startup
  log", seconds since launch, redacted supervisor output). The BioArt router now
  takes the project root from `ARC_PROJECT`, which is where the supervisor places
  the cache; under the desktop's `\\?\` paths the cache had been refused as outside
  the data directory (found by the native journey, fixed with a regression test).

## Treatment comparison (task outcomes, then appearance)

Two restrained shells were built behind a temporary `shell` query switch and driven
by the same Playwright journeys at 1280×720 and 700×800 against the compiled service
(`.omx/artifacts/ux-compare-20260920/results.json`, screenshots beside it):

| Journey | Rail | Top bar |
| --- | --- | --- |
| First Research action (cold load → token → question → Create and start) | 1 click, 2 typed fields; goal and Create visible without scrolling at both sizes | same |
| Model/effort selection and save (planner → Gemini shows minimal/low/medium/high only; OpenAI xhigh saved) | 6 clicks; Save visible; "Saved. Applied now…" | same |
| Wrong token → alert → right token → recovered | alert 12 px below the failed button; recovered | same |
| Release decision readable after the mission | chip and one-line limit visible at 1280×720; ledger 253 px below the fold (542 at 700×800) | chip visible; ledger 306 px below the fold (542 at 700×800) |

The outcomes tie on every measured step; the top bar costs 50 px of height on every
screen and loses the Main/Tools grouping, and both collapse to the same wrapping bar
at 700 px. **Frozen: the rail.** The top bar and the query switch were removed. The
separate vision/UX reviewer reached the same choice from the screenshots and the
table (its condition — the Settings table clipped in the rail — was a build-skew
between the two screenshot sets; the one-column Settings layout was built before
the reviewer ran and is what ships).

## Checks (per kind of evidence)

- Mocked fixtures: Vitest 111 passed (12 files); pytest 810 passed / 65 skipped
  (skips are Blender, POSIX-only and symlink-privilege cases; one new BioArt layout
  test fails on the old code and passes on the fix); cargo test 34 passed / 2 ignored,
  clippy `-D warnings`, rustfmt, release build; `npm audit` 0 vulnerabilities.
- Browser service (compiled bundle, real Python service, isolated data): Playwright
  21/21 Chromium journeys; before/after galleries at 1280×720 and 700×800
  (`.omx/artifacts/ux-before-20260920`, `ux-after-20260920` for both treatments,
  `ux-final-20260921` for the frozen design) and the final journey table
  (`ux-final-20260921/journeys/results.json`: first Research action 1 click and 2
  typed fields with the goal and Create visible cold; Settings planner save
  "Saved. Applied now: Research Models, effort, providers, prose, MCP servers, ACP
  agents, viewer, rendering"; a rejected token shows the error-tone notice 8 px from
  Create and start and the right token recovers; after a mission stops the results
  scroll into view and the ledger sits 226 px (1280×720) / 319 px (700×800) below the
  fold with the release chip visible).
- Native EXE (`Arc Science.exe`, SHA-256
  `833CF5CBCB3528D68D806FE8147FB07F577B0FB0043C21DFD8403909460CADEC`, 4,580,864
  bytes, built from this working tree): Playwright over CDP through the diagnostic
  attach against an isolated workspace (`ARC_DESKTOP_PROJECT`, no user data touched),
  `.omx/artifacts/native-journeys-20260921/report.json` and screenshots 01–15. The
  listener's owner chain was `msedgewebview2.exe <- Arc Science.exe (recorded pid)`.
  Observed through the real window: the desktop session unlocks Research without a
  page token; "Use operator token" locks Create and start with the shared notice; an
  offline mission was created, completed and replay-verified ("Scientific validity is
  not established by replay verification"); Memory loaded sessions and searched;
  Settings loaded and offered only minimal/low/medium/high for a Gemini API seat;
  Prose rewrote locally keeping `4.2 nM` and `(n = 3)` and refused "make it
  undetectable" before anything left; Diagnostics refreshed and loaded capabilities;
  BioArt reported a cache miss with the one-use consent wording (before the fix it
  refused with "cache must be inside the project"); Molecules loaded the deposited
  RCSB 1DQJ mmCIF (4,793 atoms), was rotated by a drag on the Mol* canvas, started a
  640 px / 4-sample preset render that was cancelled from the visible control, then
  completed a second one through every stage. Two limits: a wrong page token cannot
  lock an owned native window (the host header authenticates every exact-origin
  request, by design), and Playwright intercepts WebView downloads while attached, so
  the host's own download path was exercised separately with UI Automation without
  the attach (`uia-download/uia-download.log`): "Download collage.png" saved
  `419c16ee…-collage.png` (112,926 bytes, SHA-256 `ea135eb0…58`) to Downloads and the
  header notice said so; the same bytes came through the CDP-captured download and
  match the hash the page lists for the served file. A cold launch on a fresh empty
  workspace passed `scripts/native-gui-acceptance.ps1` (`acceptance/acceptance.log`,
  `printwindow.png` 2586×1630: Research first, native session, mission list without a
  page token, close → desktop, supervisor and service exited, port 8080 free).
- Session boundary from inside the attached window: `/api/missions` 200 with no page
  token; `http://localhost:8080/api/…` and `http://127.0.0.1:8095/api/…` both fail
  (CSP `connect-src 'self'`, no native header for another authority); `/health` 200;
  document CSP `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none';
  base-uri 'none'`, no CORS header; an injected `<img onerror>` did not run;
  `window.open` returned null and no second page appeared. Not exercised: a
  redirecting `/api` response and a stale secret after a service restart. A second
  attached launch while one is open is refused with the reason in the failure dialog.
- Real external tools: Blender 5.2.2 LTS (portable, machine-local path added to the
  isolated workspace's `arc-science.toml`) rendered the 1DQJ complex from the native
  window: 49 residue pairs at ≤ 4 Å, panels a–d, receipt hashes listed in the window
  (`13-molecules-completed.png`, `14-molecules-downloaded.png`).

## Independent review

- Vision/UX reviewer (separate Claude context on the screenshot sets and the task
  table): changes-required → the findings that survived adversarial verification
  were applied in a second editor round (release decision said once and its current
  state defined; one lock notice everywhere; effort hint once; save notice in section
  names; Prose actions above the fold; Molecules lock chain; Memory engine line
  moved to Diagnostics); refuted findings are recorded in the review JSON with the
  verifier's reason.
- Copy reviewer (separate Claude context on the sources against the service code):
  changes-required → applied as above; the contradictions it found (public data in
  live mode, probe count, MCP consent wording, the "analyst" role, live-mode create
  without consent, raw errors in Molecules) are fixed.
- Sol (GPT-5.6, read-only, thread `01a0c07d-5d70-7d82-b656-aff85fe95351`) on the
  native and shell diff: changes-required → dedicated diagnostic profile, record
  published only after the listener answers, Wry's autoplay default re-applied,
  alert role on the first line only; the query-parameter propagation went with the
  frozen treatment. Round 2 (changes-required): the diagnostic profile must fail
  closed and one attached window at a time; publication should check the DevTools
  endpoint, not a bare listener → applied (fallible profile, refusal of a second
  attach while the recorded process runs, `/json/version` check). Round 3:
  **accept-with-findings** (low: the single-instance check is check-then-remove, not
  an atomic lock; two simultaneous first launches could both pass — watch item).
- A cross-vendor vision review is **blocked**: Claude CLI credit and the Gemini tier
  were refused earlier the same day; the vision review above is a separate Claude
  context, not a different vendor.

## Remaining gates

| Gate | State | Evidence or next action |
| --- | --- | --- |
| Design system, icons, copy across the seven workspaces and startup | verified for this build | galleries, journeys, native screenshots above; both reviewers' surviving findings applied |
| Treatment comparison and freeze | verified | table above; rail frozen, top bar removed |
| Playwright from the actual EXE | verified (development attach) | `native-journeys-20260921/report.json`; owner chain proven; record published only after `/json/version` |
| Native download through the host's own handler | verified by UI Automation only | Playwright intercepts downloads while attached; hash matched on both paths |
| Native session: second local origin, untrusted rendered text, second window | verified for this run | boundary observations above |
| Native session: redirecting `/api` response, stale secret after a service restart | unverified | needs a fault-injecting service; the old generation is expected to 401 |
| Native failure page: Retry / Open log clicks | unverified | a synthetic slow or invalid executable launch is still needed; the refusal dialog of a second attach was observed |
| Independent vision review by a different vendor | blocked | Claude CLI credit and Gemini tier refused earlier on 20 September; a separate Claude context reviewed instead |
| Evolving coordinate frames (trajectory contract) | unverified | out of this increment; "live" still means stages and a contact overlay |
| Provider OAuth/API/CLI live routes, MCP `tools/call`, ACP `session/prompt` | unverified live | next increments of the recovery plan |
| Clean-profile portable install | unverified | the workspace still points at this checkout's Python source |
| Watch items | — | single-instance attach lock is not atomic; the Prose local rule table is case-sensitive ("In order to" at a sentence start is left alone); Settings tables scroll sideways at 700 px instead of stacking; Cancel and Resume stay visible on finished missions (disabled, by test anchor); the refused-attach instance needs its dialog dismissed before the window closes |

Nothing here is a production, novelty or scientific-validity claim.
