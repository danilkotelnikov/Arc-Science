# Slice 6 — native evidence and portable install: development record

Date: 21–22 September 2026. Plan and acceptance: [agentic product specification](2026-09-21-agentic-product-spec.md) §4 slice 6 and §5.
Agent: Claude Code (`claude-opus-5`, ultracode orchestration: one read-only planner, four
editors with disjoint files, one independent reviewer). The contract is
`.omx/artifacts/slice6-native-20260921/plan.json`. Sol (GPT-5.6) was blocked by the Codex
usage limit until 25 September, so the contract was not cross-checked. Nothing here is a
production, novelty or scientific-validity claim.

## Objective, preserve, acceptance

- **Objective.** The native journeys of slices 1–5 become versioned drivers that anyone
  can rerun against the real desktop binary: an isolated launch with its own project,
  app-data folder and port; eleven named journeys over the diagnostic attach (offline
  mission, reopen, diagnostics, opening the startup log from the workbench, export with a
  real download verified from disk, a service killed mid-mission and the window
  relaunched, resume, close, release); the download driver through UI Automation; the
  failure page's `Open startup log` and `Retry` driven once; the acceptance script
  asserting the release of processes and port; a fresh-profile app-data override so no
  run touches the operator's `%LOCALAPPDATA%\ArcScience`; a clean-profile package check
  of the bundled layout; CI building the supervisor so the real-supervisor tests run.
- **Preserve.** The e2e contract of the browser suite (no `window.ipc` there, so the
  700 px Diagnostics test keeps counting seven buttons); the launch modes (explicit
  launcher environment, self-configuration through the supervisor, reuse of a running
  service); the startup-log redaction rules; the IPC origin check before any parsing;
  `failure_recovery_action` and the `arc-science://` scheme gated to the failure page;
  the attach title; the settings and e2e serving code.
- **Acceptance** (from the specification): journeys regenerate their report; the
  acceptance script fails on a leaked listener; the failure page's Retry and Open log are
  observed; a portable run's service path is under the package.

## Changes

- **Desktop (Rust).** New environment variable `ARC_DESKTOP_APPDATA`: an absolute folder
  that replaces `%LOCALAPPDATA%\ArcScience` for the startup log, the WebView2 profiles
  (`webview`, `webview-diagnostic`), the diagnostic attach record and the default
  workspace (`<folder>\workspace`); relative or empty values are refused.
  `launch::app_data_directory()` is built on a pure `resolve_app_data(override, base)`
  and `workspace()` derives its default from it, so one function carries the override
  everywhere (the duplicated `LOCALAPPDATA`/`HOME` block in `workspace()` is gone). The
  loaded workbench may post `{"kind":"open-startup-log"}` over the existing IPC channel;
  the host origin-checks it as before, `page_request()` recognises only that kind (every
  other body still goes through the credential parser, whose reason never echoes the
  body), and `open_log_allowed(from_page, workbench_loaded, recovery_available)` honours
  it only once the workbench is loaded (the failure page keeps its own path, gated on
  `recovery_available`); a refused request is ignored silently. Log lines: `Diagnostics:
  open log requested by the workbench page` and `Diagnostics open log failed: <reason>`;
  the `Recovery: …` lines and Retry are unchanged and Retry is never reachable over IPC.
  Tests for the override, the default workspace, the page-request parser and the four-row
  gate table; README rows and paragraphs for the variable, the attach record path and the
  open-log request.
- **Drivers (scripts).** `native-launch.ps1` launches `arc-science-desktop.exe` on a
  mandatory `-Project` and `-AppData` and a port that is never 8080 (a listener already on
  the port, or a `arc-science.toml` naming another port, is refused); it sets and restores
  `ARC_DESKTOP_PROJECT`, `ARC_DESKTOP_APPDATA` and, with `-Attach`,
  `ARC_DESKTOP_DIAGNOSTIC_ATTACH`, clears the explicit launcher variables, runs the
  supervisor's `init --auto` when the workspace is new and rewrites its `port = 8080` to
  the requested port, polls `/health` (with `-Attach` also the attach record) and prints
  one JSON line on stdout; `-FailingService` uses the explicit mode with `cmd.exe /c exit
  3` so the failure page appears. `native-journeys.mjs` runs the eleven journeys in a
  fixed order with stable names (`fresh-profile`, `attach`, `offline-mission`, `reopen`,
  `diagnostics`, `open-startup-log`, `export`, `interrupt-kill`, `interrupt-reopen`,
  `close`, `release`), Playwright resolved from the web package, a wiped scratch folder
  (`%TEMP%\arc-native-journeys`, refused unless the path ends so), screenshots 01–14, the
  UIA download and `python -m arc_science verify` of the archive, the fake planner
  (`scripts/fixtures/fake_planner_cli.py`, the slice-4 stand-in with its `--arc-sleep`
  prefix, wrapped by a generated `fake-claude.cmd` sleeping 25 s before the kill and 2 s
  before Resume) and the fake MCP server (the unchanged
  `apps/arc-science/tests/fixtures/fake_mcp_server.py`, copied into the scratch folder
  because the Settings arguments field splits on whitespace and the repository path
  contains spaces; its digest is recorded), a kill that matches exactly one `python.exe`
  by `arc_science`, `--port <port>` and the scratch workspace in its command line (any
  other count throws), `CloseMainWindow` with a 20 s wait, a release check over every
  recorded pid and the port, and the fresh-profile comparison of the operator's
  `%LOCALAPPDATA%\ArcScience` timestamps taken before and after. Every string in
  `report.json` passes `redact()`; the exit code is 1 when any journey is not ok or an
  exception occurred, and the report is written in either case.
  `native-uia-download.ps1` is the slice-5 download driver versioned: the window is the
  process given by `-ProcessId` (never found by name), `Download PNG` then `Export replay
  archive (.zip)` through Invoke → accessible default action → focus and Enter, a new
  stable file in Downloads within 30 s with its bytes and SHA-256, the page's `Saved …`
  notice, a redacted log and the last stdout line `RESULT png=<path> zip=<path>`.
  `native-failure-page.ps1` launches the failing service, finds the owned `Arc Science
  could not start` dialog among the top-level windows of that process id (UI Automation
  exposes its localised OK button without patterns, so the button receives `BM_CLICK`),
  reads the alert, activates the `Open startup log` hyperlink (evidence: `Recovery: open
  log requested` in the app-data startup log; a viewer started by the click is closed),
  activates `Retry (reopens Arc Science)` (evidence: the old pid exits and a new
  `arc-science-desktop.exe` with the same path appears — the relaunched process resets the
  same startup log, so no log line can carry this), dismisses the new process's dialog,
  closes it and asserts that nothing of either process and no listener is left.
- **CI, acceptance and portable check.** `arc-science.yml` watches `native/arc-science/**`
  and builds the supervisor before pytest, so the real-supervisor settings test and
  `settings.e2e.js` run instead of skipping (an unverified gate: CI was not executed here,
  the YAML was linted). `native-gui-acceptance.ps1` accepts `-ProcessId` (only that
  process is considered) and the attach title, asserts that supervisor, service and memory
  worker exit within 10 s of the close and that nothing listens on the port (throwing
  otherwise), and `-InjectListener` binds a loopback listener after the exit so the
  assertion can be seen failing. `native-portable-check.ps1` stages the four executables
  and the `arc_science` package under `<scratch>\portable\lib\python`, proves first that
  the interpreter cannot import the package on its own (else exit 2, inconclusive),
  launches the staged desktop through `native-launch.ps1` and asserts that the workspace
  configuration, `/api/diagnostics` and the listener's owner chain all point into the
  portable root; no interpreter is bundled and the report says so.
- **Diagnostics UI (web).** Inside the desktop window (`window.ipc.postMessage` present)
  the Diagnostics page shows `Open startup log`, which posts `{"kind":"open-startup-log"}`
  to the host and reports `Asked the desktop app to open the startup log.` — no fetch, no
  token, not a busy task; in a browser the sentence says the page can open it only inside
  the desktop window. Tests cover both; the bundle was rebuilt.

## How to regenerate

All commands run from the repository root on the operator's Windows machine while the
operator's own instance (port 8080, `%LOCALAPPDATA%\ArcScience`, `Arc Science.exe`) stays
untouched: every run uses `native/arc-desktop/target/release/arc-science-desktop.exe` (or a
copy under a scratch folder), its own project and app-data folders and port 8090 or 8091.
Reports and screenshots are local evidence under `.omx/artifacts/slice6-native-20260921/`
(untracked): they hold machine facts (process ids, timings, a listener chain, the
downloaded files) that are meaningful only for the run that produced them, so they are
regenerated rather than committed. Every string written into a report passes `redact()`:
`USERPROFILE` (case-insensitive) becomes `~` and the scratch root becomes `<scratch>`; no
script reads a token, secret or credential except the isolated workspace's own
`data/access.token`, used only as a request header and never written.

1. Rust, web and Python: `cargo fmt --check`, `cargo test --locked`, `cargo clippy --locked
   --all-targets -- -D warnings` and `cargo build --release --locked` (each with
   `--manifest-path native/arc-desktop/Cargo.toml`) → fmt and clippy clean, 44 passed /
   2 ignored (the README's count; the contract expected 43), a fresh
   `arc-science-desktop.exe`; in `apps/arc-science/web`:
   `npm test` (172 tests expected) and `npm run build`; in `apps/arc-science`:
   `PYTHONUTF8=1 python -m pytest -q tests/test_settings.py` (the real-supervisor case runs
   because the supervisor is built here). Grep the diff for the contract's forbidden
   quality adjective and for the two shell fetch tools the house rules deny: no hits.
2. `node scripts/native-journeys.mjs --out .omx/artifacts/slice6-native-20260921/journeys`
   → exit 0; `report.json` with the eleven journey names all `ok`, screenshots 01–14, the
   zip and png beside them, `uia-download.log`; `grep -i "$env:USERPROFILE"` over the
   report finds nothing; `fresh-profile.ok` true (compare with a manual `Get-Item
   $env:LOCALAPPDATA\ArcScience, $env:LOCALAPPDATA\ArcScience\startup.log` taken before).
   Flags: `--exe`, `--port` (8090), `--python` (first `where python`; must import `mcp`),
   `--journeys a,b` (subset in the fixed order; `attach`, `close`, `release` and
   `fresh-profile` always run), `--scratch` (must end in `arc-native-journeys`).
3. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-failure-page.ps1
   -Out .omx/artifacts/slice6-native-20260921/failure-page` → exit 0; `failure-page.json`
   shows the alert starting `Service exited before readiness`, `open_log.log_line`
   `Recovery: open log requested`, `retry.new_pid` different from `launch.pid`, and
   `cleanup.processes_left` empty with `listener` `none`.
4. Acceptance: `$l = powershell -NoProfile -ExecutionPolicy Bypass -File
   scripts/native-launch.ps1 -Project $env:TEMP\arc-accept\workspace -AppData
   $env:TEMP\arc-accept\appdata -Port 8090 -Attach | ConvertFrom-Json`, then `powershell
   -NoProfile -ExecutionPolicy Bypass -File scripts/native-gui-acceptance.ps1 -Out
   .omx/artifacts/slice6-native-20260921/acceptance -Port 8090 -ProcessId $l.pid
   -SkipExternal -SkipDownload -InjectListener; $LASTEXITCODE` → 1 with the log line `port
   8090 listener after close: PRESENT`; relaunch and rerun without `-InjectListener` → 0
   with the window found under the attach title. Afterwards confirm the operator's
   instance and port 8080 are untouched.
5. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-portable-check.ps1
   -Out .omx/artifacts/slice6-native-20260921/portable` → exit 0; `portable-check.json`
   with `package_path` and `supervisor_path` under `<scratch>\portable` and
   `precondition_not_installed` true (exit 2 means the interpreter can already import
   `arc_science`, so the run is inconclusive).
6. CI lint only: `python -c "import yaml; d=yaml.safe_load(open('.github/workflows/arc-science.yml')); r=[s.get('run','') for s in d['jobs']['app']['steps']]; assert [i for i,x in enumerate(r) if 'native/arc-science/Cargo.toml' in x][0] < [i for i,x in enumerate(r) if x.startswith('python -m pytest')][0]; assert 'native/arc-science/**' in d[True]['push']['paths']; print('ok')"`
   (the `on` key parses as `True`).

## Checks (per kind of evidence)

- Mocked: pytest 885 passed / 65 skipped on the final tree (`ARC_SVG2PNG` set;
  `tests/test_settings.py` runs its real-supervisor case because the supervisor is
  built here); Vitest 13 files, 172 tests (the `Open startup log` button only inside the
  desktop window and its IPC body; the browser sentence); cargo fmt and clippy clean,
  44 tests passed / 2 ignored (the override prefers an absolute `ARC_DESKTOP_APPDATA`
  and refuses relative or empty values; the default workspace lives under the app-data
  folder; `page_request` recognises only `open-startup-log` and never echoes another
  body; the four-row `open_log_allowed` table; the recovery actions still gated to the
  failure page).
- Browser service: Playwright 31/31 on the rebuilt bundle (the 700 px Diagnostics test
  still counts seven buttons: no `window.ipc` in a browser).
- Versioned journey driver on the rebuilt desktop binary (`arc-science-desktop.exe`
  SHA-256 `E5C368ABB391DA2639B6CD294DB0CE4DD6AE146C6B0DB0FED683505886C3413B`, 4,605,440
  bytes; the launcher's `Arc Science.exe` copy refreshed to the same bytes once the
  operator's window had closed): `node scripts/native-journeys.mjs --out
  .omx/artifacts/slice6-native-20260921/journeys-orchestrator` → exit 0 in 2 min 20 s,
  all eleven journeys `ok` — `fresh-profile` (the operator's `%LOCALAPPDATA%\ArcScience`
  and its `startup.log` carry the same timestamps before and after, no attach record
  written there), `attach` (`python.exe <- arc-science-native.exe <-
  arc-science-desktop.exe`), `offline-mission` (12 timeline rows from `start` to `stop`,
  three claim cards with the ten rows), `reopen` (the same id from
  `arc.research.mission`, values are ids), `diagnostics` (host session `owned`, five
  cards with their sources, the report without home path or bearer value),
  `open-startup-log` (the host logged `Diagnostics: open log requested by the workbench
  page`, the page read `Asked the desktop app to open the startup log.`, the Notepad
  viewer that opened was closed), `export` (no download before verification, two
  `Download PNG` buttons after; the UIA driver downloaded the PNG — 20,592 bytes whose
  SHA-256 is the artifact digest — and the archive — 56,187 bytes, `python -m arc_science
  verify` → format 3, integrity true, reproduction passed, nine members),
  `interrupt-kill` (exactly one service process of the scratch workspace stopped during
  the planner call; `Arc Science is not reachable …`; the window closed), `interrupt-reopen`
  (relaunched on the same folders: the same mission `paused` with the `Interrupted`
  banner, the plan row `no outcome recorded`, an `interrupt` row from the service, Resume
  to completion), `close`, `release` (seven recorded pids gone, no listener). Screenshots
  01–14, the downloaded files and the redacted UIA log are beside the report; the report
  contains no user path. The reviewer's and the fix round's runs of the same driver are
  under `journeys/`.
- `scripts/native-failure-page.ps1` (reviewer and fix round, `failure-page/`): exit 0;
  the dialog `Arc Science could not start` dismissed on the launched pid only; the alert
  `Service exited before readiness: exit code: 3`; `Open startup log` → `Recovery: open
  log requested` in the scratch app-data log and a Notepad viewer closed; `Retry (reopens
  Arc Science)` → the old pid exited and a new `arc-science-desktop.exe` appeared, failed
  the same way (inherited environment), was dismissed and closed; nothing left, no listener.
- `scripts/native-gui-acceptance.ps1` (reviewer, `review/acceptance-*` and the
  ci-portable editor's `acceptance-*`): with `-InjectListener` exit 1 and the line `port
  8090 listener after close: PRESENT pid …` after the supervisor and service had exited;
  without it exit 0, the window found under the attach title by its process id.
- `scripts/native-portable-check.ps1` (`portable/`): exit 0; `import arc_science` fails
  without `PYTHONPATH` (the package is not installed in the interpreter), the staged
  desktop's workspace names `<scratch>\portable\lib\python`, `/api/diagnostics` names
  the supervisor under `<scratch>\portable`, the listener chain's two executables run
  from the portable root, the tree exited and the port was released.
- CI: `arc-science.yml` linted (the supervisor build precedes pytest; the paths lists
  include `native/arc-science/**`); not executed here — an unverified gate.
- Nothing left this machine; the operator's instance, workspace, port and app-data were
  never used. During the Rust rebuild the operator's own window was still running from
  `arc-science-desktop.exe`, so the editor renamed the mapped file aside before building
  (the process kept running; the renamed copy was removed once the window had closed).

## Independent review

- Reviewer (separate Claude context; whole diff, cargo, Vitest, the settings pytest, the
  journey driver, the failure-page driver, the acceptance self-test both ways, the
  portable check and the CI lint): **accept** with one major finding — the failure-page
  driver wiped a caller-supplied `-Scratch` folder without the name guard the two sibling
  drivers have — and two minor ones (a UTC/local mismatch in the viewer-closing filter of
  the journey driver; a BOM on `failure-page.json`); all three applied in the fix round,
  which reran both drivers green. Review and editor reports:
  `.omx/artifacts/slice6-native-20260921/review-and-editors.json`.
- Sol (GPT-5.6): blocked by the Codex usage limit until 25 September.

## Requirement states after this slice

| ID | State | Evidence |
| --- | --- | --- |
| A7 | partly verified | setup, permission, mission, interruption and relaunch, pause, claim review, diagnostics and export journeys regenerate from one versioned driver on the desktop binary at desktop size; narrow-size captures exist for slice 1 only |
| A8 | partly verified | clean-profile package check of the bundled layout, the failure page's recovery controls, the fresh-profile override, the acceptance script's release assertions; performance measurements and live probes on the operator's account remain; CI unverified; no production claim |
| J8 | extended | the fresh-profile override keeps every run out of the operator's data; the failure page's Retry and Open log observed once; the interrupted service and relaunch on the versioned driver; the redacted reports carry no user path |
| G (diagnostics) | extended | `Open startup log` works inside the desktop window over the origin-checked IPC; the browser copy says why it cannot |

## Remaining gates

- CI execution on GitHub (the YAML is linted only).
- Narrow-size (700 px) captures of the slice 4–5 sections on the desktop binary.
- A live mission on the operator's own account and a render retry that completes (no
  Blender Python here).
- Performance measurements before any production claim.
