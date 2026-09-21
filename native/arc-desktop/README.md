# Arc Science desktop

`Arc Science.exe` starts on its own. Without any `ARC_DESKTOP_*` environment it
finds the supervisor (`ARC_DESKTOP_SUPERVISOR`, a sibling `arc-science-native.exe`,
the development layout `native/arc-science/target/release`, then `PATH`), uses the
workspace `ARC_DESKTOP_PROJECT` or `%LOCALAPPDATA%\ArcScience\workspace`, runs
`init --auto` when no `arc-science.toml` exists (Python, package root and native
components are discovered; the interpreter runs once to report its version and
import the package), reads `startup-plan`, and — if the plan is not ready — lets
`discover --apply` fill the empty fields of an older configuration. The window opens
immediately with the plan's checks; the service starts on a thread; the workbench
loads when `/health` answers with the service identity. A failure is shown in the
window and in a native dialog with the supervisor's last stderr lines.

The executable is a windowed application: a double-click opens no console, and
when a shell starts it (the launcher, `--check-startup`) that shell's console is
attached for its text output. Text shown from the supervisor's stderr passes
through a redaction pass (bearer values, `name=value` secrets, long opaque tokens)
before it reaches the window or the dialog. An explicit `ARC_DESKTOP_SUPERVISOR`
that is not a file is refused, never silently replaced.

[The PowerShell launcher](../../scripts/start-arc-science.ps1) remains for
`-Build`, `-ProjectPath`, `-Python`, optional `-BlenderPython` and headless
`-CheckStartup`; it sets the explicit environment below, which always wins.
It does not install Python dependencies or overwrite an existing project configuration.

A Rust desktop host for the existing local Python service and compiled React
workbench, using a native WebView2 window on Windows and the Snöggo mark (the
black mark with its inner puddles filled white, transparent outside) as window
icon, executable icon and workbench header mark. The scientific worker is
deliberately retained; this is not a Rust rewrite of the scientific algorithms.

The shipped executable is `Arc Science.exe`. Cargo cannot name a target with a
space, so the build produces `arc-science-desktop.exe` and the launcher copies it
under the product name; `build.rs` embeds `assets/arc-science.ico` and the version
block with the Windows SDK's `rc.exe` (found on `PATH`, via `ARC_RC_EXE`, or under
`Windows Kitsin`), so no build crate is needed. Regenerate the icon after
changing the mark with `python scripts/make-icon.py`.

## Build and launch

```powershell
cargo build --release --locked --manifest-path native/arc-desktop/Cargo.toml
cargo build --release --locked --manifest-path native/arc-science/Cargo.toml
```

For owned process-tree shutdown, use the existing `arc-science-native` supervisor.
Initialize an existing private project directory with its `init --python <path>`
command once, then configure literal arguments (PowerShell example):

```powershell
$env:ARC_DESKTOP_EXECUTABLE=(Resolve-Path native/arc-science/target/release/arc-science-native.exe).Path
$env:ARC_DESKTOP_ARG_COUNT='4'
$env:ARC_DESKTOP_ARG_0='--project'
$env:ARC_DESKTOP_ARG_1='C:\Users\you\Arc Science Project'
$env:ARC_DESKTOP_ARG_2='serve'
$env:ARC_DESKTOP_ARG_3='--parent-stdin'
$env:ARC_DESKTOP_URL='http://127.0.0.1:8080/'
& "native/arc-desktop/target/release/Arc Science.exe"
```

The selected project must contain the supervisor's `arc-science.toml`, with a
Python interpreter that can import Arc Science. The URL host and port must match
that file. Neither binary installs Python packages. `ARC_MEMORY_WORKER` enables the
existing session-memory worker; no embedding model is installed automatically.

## Configuration

| Variable | Default | Contract |
| --- | --- | --- |
| `ARC_DESKTOP_URL` | `http://127.0.0.1:8080/` | Absolute HTTP URL with numeric loopback IP, no userinfo. Paths, query and fragment are preserved; readiness always uses root `/health`. |
| `ARC_DESKTOP_EXECUTABLE` | `arc-science` | One executable name or literal path; spaces/Unicode need no embedded quoting. Windows batch files are rejected. |
| `ARC_DESKTOP_ARG_COUNT` | `1` for the default command | Required with an explicit executable; integer 0–64. |
| `ARC_DESKTOP_ARG_0` ... | `serve` for the default command | Each value is one literal argument. Empty arguments and spaces are preserved; shell syntax is not evaluated. |
| `ARC_DESKTOP_TIMEOUT` | `30` | Readiness deadline in seconds, 1–300. |
| `ARC_DESKTOP_SERVE` | unset | Only the exact legacy value `arc-science serve` is accepted. Other command strings fail with migration instructions. Cannot be combined with an explicit executable. |
| `ARC_DESKTOP_DIAGNOSTIC_ATTACH` | unset | Development only. The literal `1` opens the WebView2 DevTools protocol on an ephemeral loopback port for one run (see below); any other value is an error. |

Configuration is captured once. Missing argv entries and invalid settings fail
before network access or process creation. Stale entries beyond `ARG_COUNT` are
unused. `--check-startup` runs exactly the startup contract without making a window,
prints whether the service was owned or reused, and exits. Owned services then shut
down; reused services stay running.

## Diagnostic attach (development only)

`ARC_DESKTOP_DIAGNOSTIC_ATTACH=1` makes the owned WebView2 open the Chromium
DevTools protocol on an ephemeral port bound to `127.0.0.1`, so a Playwright client
can drive the actual window (`chromium.connectOverCDP(endpoint)`) and operate its
visible controls. One attached window at a time: a record whose process is still
running refuses a second attach. Once the DevTools endpoint answers `/json/version`
(polled for up to ten seconds after the WebView is created; an endpoint that never
answers fails the start), the host
records `{"port","pid","endpoint"}` in `%LOCALAPPDATA%\ArcScience\diagnostic-attach.json`
for the window's lifetime, writes the same fact to the startup log, and puts
`diagnostic attach on 127.0.0.1:<port>` in the window title so the mode is never
silent; the record is removed when the window closes. The attached window uses its
own WebView2 profile (`webview-diagnostic`), so it never shares a browser process with
an ordinary window. A client should still confirm that the listener on that port
belongs to `msedgewebview2.exe` under the recorded Arc Science process before
trusting the page.

The attach exposes the WebView, its network requests and therefore the native session
header to any local process that can reach the port. Enable it for one development
run on a machine you control and never in an installed copy; the flag is not set by
the launcher, the supervisor or the workbench. Wry's default WebView2 switches
(feature disables and the autoplay policy) are re-applied together with the DevTools
switch; a proxy setting, if one is ever added, would need the same treatment.

## Readiness, navigation and lifetime

Readiness requires HTTP 200 and `X-Arc-Science-Service: arc-science-v1`. This public
marker detects accidental reuse of another HTTP service; it is **not authentication**
and is not a defense against another local process imitating Arc Science. External
browser bearer authentication remains in force. Probes disable environment/system proxies and redirects,
use short connect timeouts, and never exceed the remaining startup deadline. A foreign
listener, failed executable, early child exit or timeout is shown in the window and in
an owned native dialog (the window and WebView exist first, showing the starting
state); with `--check-startup` the same conditions produce an error and nonzero exit
without a window.

An owned Windows WebView2 window also receives a per-launch native session. The host
passes a random secret only to the service process it starts and adds its header to
exact-origin `/api` Fetch/XHR/EventSource requests below JavaScript. A separate local
browser and a desktop window reusing an existing service remain on the explicit
operator-token path. The secret is never put in the URL, page state, storage or logs.
This authenticates the trusted WebView, not arbitrary same-origin scripts; keep the
service CSP and data/consent boundaries intact. See the
[native session design](../../docs/hoh/2026-09-20-native-session-design.md) and its
recorded real-window and fallback checks.

Main navigation stays on the configured scheme/IP/port. Same-origin `blob:` object
URLs remain allowed for workbench downloads; other origins and file/data/script URLs
are blocked. A new-window request (`target="_blank"`, `window.open`) never creates a
second WebView: a clean `https:` target is handed to the operating system's default
browser (`ShellExecuteW` on Windows, `open`/`xdg-open` elsewhere, never a shell), and
anything else is refused with a note on stderr.

Downloads are performed by the WebView itself. On this Windows runtime the WebView
showed no download dialog of its own, so the host reports each finished download to
the page as an `arc-download` window event (`file`, `folder`, `success`), which the
workbench header announces. The browser profile (cache, storage) lives under
`%LOCALAPPDATA%\ArcScience\webview` (`~/.arc-science/webview` elsewhere), never beside
the executable.

The desktop closes its private child-stdin pipe on normal close or startup/WebView
failure. `arc-science-native serve --parent-stdin` treats EOF as cancellation and
terminates its worker process group/job, including ordinary descendants. Standalone
`serve` and other CLI commands do not opt into this lifetime contract. Windows tests
observe both worker and descendant sockets closing on EOF. Desktop cleanup permits
three seconds for cooperative supervisor shutdown, then kills and reaps the direct
child with an explicit warning. Startup failure can therefore take up to the configured
readiness deadline plus this three-second shutdown grace.

The compatibility default `arc-science serve`, or an arbitrary configured command,
has **direct-child-only fallback**; it cannot guarantee descendant cleanup. Always use
the native supervisor for owned scientific workers. A reused service is never killed.

The supervisor's process-wrap 9.0 JobObject does not enable kill-on-job-close, so the
supervisor joins its own kill-on-close job object before spawning (`containment.rs`);
a forced supervisor kill reaps the worker and its descendants on Windows. Signed
installer distribution and other platforms remain separate release gates. Browser
automation of the shared workbench does not prove native-window behaviour; the native
window was driven separately through UI Automation (see the HoH ledger).

## Verification

```powershell
cargo fmt --check --manifest-path native/arc-desktop/Cargo.toml
cargo test --locked --manifest-path native/arc-desktop/Cargo.toml
cargo clippy --locked --manifest-path native/arc-desktop/Cargo.toml --all-targets -- -D warnings
& "native/arc-desktop/target/release/Arc Science.exe" --check-startup
```

Tests cover loopback/authority validation, root health paths, status/identity checks,
redirect/proxy settings, remaining-deadline behavior, literal argv, reuse, spawn errors,
early exits, timeout cleanup, local navigation, external-target filtering, the
download-report script literal, icon transparency and white puddles. One ignored test
is an intentional subprocess fixture executed by its owning timeout regression.

Developer verification on Windows, 2026-09-18: 12 desktop tests passed, 24 supervisor
tests passed, and 9 Python service tests passed. Both crates passed format checks,
strict clippy and release builds. A real `--check-startup` launched the Python service
from a project path containing spaces and Japanese characters, used a nested
workbench URL with root health, then closed the service and listener in 3.174 seconds
total. An existing service was reused even with a nonexistent configured executable.
Real missing-executable, child-exit-7 and one-second-timeout checks returned failure
without a window; the timeout/cooperative shutdown took 1.155 seconds. These are
single-run workstation observations, not latency guarantees or independent QA.
