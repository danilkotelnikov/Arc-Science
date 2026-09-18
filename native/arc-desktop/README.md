# Arc Science desktop

For a configured Windows checkout, [the PowerShell launcher](../../scripts/start-arc-science.ps1)
selects the native supervisor and memory worker with literal argument vectors:
`./scripts/start-arc-science.ps1 -Build` for the first build, then omit `-Build`.
It supports `-ProjectPath`, `-Python`, optional `-BlenderPython` and headless `-CheckStartup`.
It does not install Python dependencies or overwrite an existing project configuration.

A Rust desktop host for the existing local Python service and compiled React
workbench, using a native WebView2 window on Windows and the transparent Snöggo
icon. The scientific worker is deliberately retained; this is not a Rust rewrite
of the scientific algorithms.

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
& native/arc-desktop/target/release/arc-science-desktop.exe
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

Configuration is captured once. Missing argv entries and invalid settings fail
before network access or process creation. Stale entries beyond `ARG_COUNT` are
unused. `--check-startup` runs exactly the startup contract without making a window,
prints whether the service was owned or reused, and exits. Owned services then shut
down; reused services stay running.

## Readiness, navigation and lifetime

Readiness requires HTTP 200 and `X-Arc-Science-Service: arc-science-v1`. This public
marker detects accidental reuse of another HTTP service; it is **not authentication**
and is not a defense against another local process imitating Arc Science. API bearer
authentication is unchanged. Probes disable environment/system proxies and redirects,
use short connect timeouts, and never exceed the remaining startup deadline. A foreign
listener, failed executable, early child exit or timeout produces an error and nonzero
exit, before constructing a window or WebView.

Main navigation stays on the configured scheme/IP/port. Same-origin `blob:` object
URLs remain allowed for workbench downloads; other origins, file/data/script URLs and
new windows are blocked. External links currently remain blocked in this host.

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

The supervisor's process-wrap 9.0 JobObject does not enable kill-on-job-close. EOF
supervision must remain active; forcibly killing the supervisor itself is not qualified
as whole-tree containment. Platform crash/forced-termination guarantees and signed
installer distribution remain separate release gates. Browser automation of the shared
workbench does not prove native-window interaction or native download behavior.

## Verification

```powershell
cargo fmt --check --manifest-path native/arc-desktop/Cargo.toml
cargo test --locked --manifest-path native/arc-desktop/Cargo.toml
cargo clippy --locked --manifest-path native/arc-desktop/Cargo.toml --all-targets -- -D warnings
& native/arc-desktop/target/release/arc-science-desktop.exe --check-startup
```

Tests cover loopback/authority validation, root health paths, status/identity checks,
redirect/proxy settings, remaining-deadline behavior, literal argv, reuse, spawn errors,
early exits, timeout cleanup, local navigation and icon transparency. One ignored test
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
