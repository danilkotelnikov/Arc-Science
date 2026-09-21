# Slice 1 — readiness and first run: development record

Date: 21 September 2026. Plan and acceptance: [agentic product specification](2026-09-21-agentic-product-spec.md) §4 slice 1 and §5.
Agent: Claude Code (`claude-opus-5`, effort `xhigh`, ultracode orchestration). This record
separates what was changed from what was observed and from what independent reviewers
accepted. Nothing here is a production, novelty or scientific-validity claim.

## Objective, preserve, acceptance

- **Objective.** One readiness vocabulary owned by the service; Settings that load by
  themselves and offer catalogued models; a save notice that says when each section
  applies; Diagnostics and Research that read the same readiness as Settings; live mode
  that explains what is missing and leads to it; seat cards that fit 700 px.
- **Preserve.** Whole-document settings PUT with a mandatory revision at the HTTP layer;
  Rust as the sole settings writer; credential names only; `SESSION_COPY`/`LockNotice`
  behaviour; the mission hash chain and capsule format; Molecules viewer defaults.
- **Acceptance** (from the specification): native fresh profile shows seats without a
  click, one state per seat with a cause; the supervisor refuses `gemini`+`cli`+`high`;
  PUT changing only the viewer reports `changed=['viewer']` with its effect; Diagnostics
  agrees with the header; the offline fixture is usable and live mode names the missing
  seat with a link; 700 px without horizontal scroll in the browser and in the window.

## Changes

- **Service.** `readiness.py` (new): pure `build_readiness()` and `GET /api/readiness`
  (passive; reads the settings snapshot, credential presence by name, the cached CLI
  login state, the last probe record in memory then on disk, the memory worker only when
  it is already running, the renderer configuration and the mission store). States
  `ready` / `not_tested` / `failed` / `blocked` / `unknown` with a stable code, meaning,
  next action and source per seat, connector, renderer, memory, storage, session and
  settings; `live_mission` aggregates the seats a live mission needs; a connectors
  summary is computed here so the page derives nothing. `ready` is reserved for a seat
  whose last probe matched its current subject digest (provider, transport, model,
  effort, executable digest or endpoint origin, credential name). The `authorized`
  dependency returns the principal (`native` or `token`). `PUT /api/settings` diffs the
  previous and saved documents and returns `changed`, per-section `effects`
  (`next live mission start` with the bound-route note; `next prose request`;
  `next render submission`; `next Molecules session` with the stated limitation),
  `restart_required: []` with its note and `bound_missions`; the constant `APPLIED` is
  gone. Probe results record their subject and digest. `repository.list()` rows carry
  `mode`; `count_bound_live()` counts bound live missions. `memory/web.py` gains a
  passive health accessor. `exploration/model_catalog.json` (new, packaged): the
  catalog from the official pages read on 21 September (§2 of the specification),
  efforts per transport and per model, and the per-provider sign-in modes with their
  basis. `effort.py` reads it (`accepted_efforts`, `model_entry`).
- **Supervisor (Rust).** `validate()` is now `validate_schema()` (shape and enumerations,
  used when a file is read) plus `validate_transports()` (effort per provider and
  transport, and a vision seat over a CLI login is refused, used when a document is
  written), so a `settings.toml` written before these rules still loads and readiness
  reports the offending seat; the snapshot's schema block lists `efforts_by_transport`.
- **Web.** `readiness.js` (new): the state words, the release-check display map
  (satisfied → passed, unknown → unverified, error → blocked, not_applicable → n/a) and
  `sentence()`; nothing in the web app computes a readiness state any more. `main.jsx`
  reads `/api/readiness` once the desktop session is known (a manual token only when a
  workspace asks) and passes readiness, an idempotent refresh and navigation to
  Research, Settings and Diagnostics. Settings: loads on activation, on the desktop
  session and when the header token settles (Enter or focus leaving the field), never
  per keystroke and never over unsaved edits; provider, model, sign-in and effort
  choices come from the catalog; a model outside it is "Custom id (unverified)"; effort
  options are the transport's list intersected with the model's, disabled at `medium`
  where nothing applies, and a value that stops being accepted is kept, marked invalid
  and blocks Save instead of being coerced; a "Sign-in methods" list names supported,
  unavailable and not-in-this-build modes with their basis; the save notice comes from
  `effects`; a 409 offers "Reload and keep my edits", which re-applies the draft's
  changed paths onto the newer revision; one card per seat with a two-column control
  grid that stacks at ≤ 700 px; the shared badge colours (ready ok, failed danger,
  blocked warn). Diagnostics: no "paste a token"; a Session card from
  `readiness.session`; Settings, Seats, Connectors, Renderer, Memory and Storage cards
  in the shared words with meaning and next action; `Refresh readiness` replaces
  `Load capabilities`; the readiness grid uses wider cells and the settings path drops
  the `\\?\` prefix. Research: selecting live models reads the seats and shows a Live
  route panel (each configured seat's provider, model, effort and state); a blocked
  route names the blocking seat with its next action and offers `Open Settings`;
  unread seats also block Create and start; the mission overview shows the model source
  (`Offline fixture` / `Live models`) and saved missions show it per row; release checks
  use the display words. The remaining "Paste an operator token" lines in Molecules,
  Prose and the shared lock copy were reworded (manual-token mode only; a desktop
  session never showed them).

## Checks (per kind of evidence)

- Mocked: Vitest 13 files, 128 tests passed; pytest 819 passed / 65 skipped with
  `ARC_SVG2PNG` set to the native rasterizer (the same 65 skips as before: Blender,
  POSIX-only and symlink-privilege cases); `native/arc-science` cargo test 13 unit +
  1 + 9 + 15 integration passed, `cargo fmt --check` and `clippy -D warnings` clean;
  `native/arc-desktop` unchanged (34 passed / 2 ignored, clean).
- Browser service (compiled bundle, real Python service and the rebuilt supervisor on
  an isolated data directory): Playwright 26/26, including the new journeys — seats
  load by themselves; a stale save is refused and "Reload and keep my edits" carries
  the draft onto the newer revision; 700 px seat cards and providers table fit; a
  custom id is marked unverified; live mode on a service without seats is blocked in
  the composer with nothing sent and no 409; at 700×800 Research and Diagnostics fit
  and the Diagnostics buttons are reachable by Tab.
- Native EXE (`Arc Science.exe` SHA-256
  `833CF5CBCB3528D68D806FE8147FB07F577B0FB0043C21DFD8403909460CADEC`, unchanged because
  the desktop crate did not change; supervisor `arc-science-native.exe` rebuilt after the
  final review, SHA-256 `2BE93863351350BEAA5A8FA54B6B226E0169B692AE3D6CC9841D3B3CDB0059C6`,
  1,909,760 bytes; service and bundle from this working tree, the bundle rebuilt after
  the last source edit), launched with `ARC_DESKTOP_DIAGNOSTIC_ATTACH=1`
  on a fresh empty workspace (`ARC_DESKTOP_PROJECT`; the WebView profile and startup
  log under `%LOCALAPPDATA%\ArcScience` are still shared, so this is a fresh *workspace*,
  not a fresh app-data profile), driven by Playwright over CDP with the listener's owner
  chain `msedgewebview2.exe <- Arc Science.exe (recorded pid)`:
  `.omx/artifacts/slice1-native-20260921/report.json`, screenshots 01–14 and the
  drivers under `drivers/` (an earlier run against a bundle that predated the last
  edits is kept apart under `run1-stale-bundle/`, including one failed-start
  screenshot). Observed through the real window: the header said
  `Desktop session ready` and no page text told the operator to paste a token; Research
  opened with an empty goal, Create and start disabled and `Execution settings ·
  offline fixture (nothing is sent)`; choosing live models showed the Live route panel
  `No seat is configured … Blocked by: Planner — Set the provider and model for this
  seat in Settings` with `Open Settings`, Create and start stayed disabled and nothing
  was sent; `Open Settings` opened Settings, which showed the five seat cards without a
  click (revision, saved, path); the Gemini model list came from the catalog, a Gemini
  CLI seat had its effort control disabled at `medium`, a Gemini API seat offered
  low/medium/high for `gemini-2.5-pro`, an OpenAI custom id showed `Custom id
  (unverified): not in the catalog; readiness cannot be assumed`, and the sign-in list
  read `CLI login (Codex): supported · API credential: supported · In-app provider
  OAuth: unavailable`, each with its basis; Save returned `Saved (revision 7743bcb05dd2).
  Planner seat: applies at next live mission start. Missions already bound to a route
  keep it … No setting in this build needs a restart.`; Reload showed the saved values;
  Diagnostics showed `Session · Ready · Desktop session · Authenticated by the desktop
  app`, Settings with the revision, and the seat states; back in Research the live
  route read `Planner · openai · gpt-experimental-not-in-catalog · medium · Blocked …
  Store it with arc-science credential --name planner-key`; an offline mission ran to
  `budget exhausted` with the chips `Offline fixture` and `Release: Blocked`; the
  window client was resized to 700 physical px (350 CSS px on this 200 % display —
  steps `narrow-*`, captures `11–13`) and to 1400 physical px (700 CSS px —
  `narrow-700css.json`, captures `14-*`): Research, Settings and Diagnostics reported
  no horizontal scroll at both sizes; Tab from the Planner provider moved through
  model, custom id, effort, sign-in and credential in order (one seat card; the
  Diagnostics buttons are covered by the browser suite). The supervisor's refusal of
  `gemini`+`cli`+`high` is not reachable from the page (the effort control is
  disabled first); it is evidenced by the Rust test, the e2e stale/invalid save and
  the second reviewer's own PUT (422 `seats.reviewer.effort must stay medium: gemini
  cli login has no effort control`).
- Treatment comparison (`.omx/artifacts/slice1-compare-20260921/`): the previous build
  (`dcbe4be` in a worktree) and this tree, each served by the real service on its own
  data directory, driven by one script at 1280×720, 700×800 and 640×400 (this
  machine's real CSS viewport: 1280×800 physical at 200 %). Configuring the planner
  seat took 5 clicks and one typed model id before, 5 clicks and nothing typed after;
  before, the seats appeared only after `Load settings` and the seat table scrolled
  sideways at 700 and 640 px; after, they were visible on entry and no table scrolled;
  before, the seat state read `not applied — These values are not the running ones`
  (computed in the page), after it read the server's `Blocked` with the reason and
  next action; on a fresh profile choosing live models before consenting showed, before,
  only the consent sentence, and after, `Live models are blocked. Planner — Set the
  provider and model for this seat in Settings` with `Open Settings`; Diagnostics told
  a token session to paste a token before and not after, and showed the seat states
  only after. The stacked card is frozen; the alternative "editable detail panel" was
  not built, so this is a before/after measurement, not a comparison of two new
  treatments.

## Incident during the comparison (recorded, not hidden)

The first comparison run ticked the mission consent checkbox and pressed Create and
start on both services after configuring a Gemini **CLI** planner seat. On this machine
the Gemini CLI is installed and has a cached login, so the service treated the mission
as runnable and attempted one planner call per mission through `gemini -p` — nine
missions across the two services, each stopping at `error` ("Planning failed
validation or provider execution") with no model record. The Gemini CLI wrote one
session file per attempt containing only its own session-context message; no model
reply was recorded. The text involved was the harness goal `Compare two fits.` plus
Arc's fixed planner instructions; no scientific data, file or credential. Whether a
request reached Google before the failure cannot be told from these files. The harness
was corrected to never tick consent or press Create with a runnable seat, and the
comparison was rerun on fresh services. The lesson is a product one and belongs to
slice 3: consent plus one click is today the whole path to an external call, and the
grant preview must show exactly which process and account the first call will use.

## Independent review

- First review (separate Claude context, code + suites + black-box `/api/readiness`):
  changes-required with four major findings — a CLI vision seat could read as verified
  although the service refuses visual review over a CLI login; Settings autoload fired
  per keystroke of the header token; "paste a token" survived in shared copy; the
  stale-save e2e could not see a control inside a closed section — and eleven minor
  ones. All four majors were fixed by the owning editors; of the minors, the passive
  memory accessor, the API subject digest, `live.unknown`, the server-side connectors
  summary, the double JSON parse, the badge colours, the lenient load in Rust and the
  unread-seats gate in Research were applied by the orchestrator; the Connections table
  in Settings still reads `/api/capabilities` (its running-seats and CLI-login facts are
  not in readiness yet) — carried to slice 2.
- Second review of the final tree (separate Claude context, 85 tool calls; code,
  suites and a live check of the rebuilt source through the real supervisor;
  `.omx/artifacts/slice1-native-20260921/final-review.json`): changes-required with two
  majors — (1) readiness said an inherited reviewer or falsifier "inherits" while the
  runtime resolved it to a credential named after the inheriting role when the
  planner's credential name was empty, so a planner-only API route read `not_tested`
  yet was refused with a generic 409; fixed at the root (`endpoints_from_settings`
  builds an inherited seat under its owning role, so it uses the planner's credential)
  with a test that reads and starts such a route consistently; (2) the packaged bundle
  predated the last source edits and the native evidence had been taken against it;
  the bundle was rebuilt and the native journey, the 700 CSS px record and the
  Playwright suite were rerun against it (this record cites the rerun). Minors
  applied: the 33-space refusal string in `settings.rs`; `settings check` runs the
  full validation; the Live route's error goes through the shared copy; the
  Diagnostics grid never exceeds its container; a seat that cannot be read carries
  `seat.unknown`; the specification's §3.1 names the implemented vocabulary; the
  bound-mission count runs off the event loop; the stray `test-results` directory was
  removed. The reviewer did not re-run after these fixes: the loop closes with an
  author-applied fix round after two independent reviews and the regenerated
  evidence, not with a third independent acceptance.
- Sol (GPT-5.6): the design review of this slice is in the specification (§3); a second
  Sol review of the diff was requested and **refused by the Codex usage limit** (reset
  25 September), so it is blocked, not skipped.

## Requirement states after this slice

| ID | State | Evidence |
| --- | --- | --- |
| A1 | verified for this build | native report steps `shell`, `research-fresh`, `research-live`, `settings-autoload`, `diagnostics`; comparison `jlive`/`jdiag` |
| A2 | partly verified | catalog picker, custom id unverified, effort intersection, supervisor refusal (cargo + e2e), route freeze already existed; capability fit shown per catalog entry; per-role budget and fallback policy not stored (spec §3.6); live readiness of API seats is `not_tested` until slice 2 adds their probe |
| J1 | verified for this build | native report; Playwright `live mode on a service without seats is blocked … no 409` |
| J2 | partly verified | native `settings-gemini-cli`, `settings-custom`, `settings-saved`, `settings-reloaded`; unavailable provider path shown with basis; Connect/Test/Disconnect are slice 2 |
| J7 | partly verified | Diagnostics agrees with the header (native `diagnostics`); 700 px native and browser; keyboard order on Settings; Memory/Molecules/BioArt links are later slices |
| C0 | blocked | Claude Science unreachable |

## Remaining gates and watch items

- Slice 2: native credential boundary (Windows credential prompt and store), Test for
  API seats with persisted probes, Remove, `ant` profile detection; the Connections
  table off `/api/capabilities`.
- Fresh app-data profile for native runs (`%LOCALAPPDATA%\ArcScience` override) —
  slice 6.
- The autoload document listener on `#operator-token` couples Settings to the header's
  element id; a settled-token state in the shell would be cleaner (reviewer note).
- The native window on this machine renders at 640×400 CSS px when maximised (200 %
  scaling); all three surfaces fit there, but the composer needs scrolling to reach
  Create and start — a layout observation for the cockpit slice.
