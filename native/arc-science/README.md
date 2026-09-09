# Arc Science native supervisor

**Qualification gate I1:** the source now gives supervised renderers the native
process group/job as their outer containment boundary. A deterministic regression
blocks Python after renderer acquisition, sends two native termination signals and
requires FIFO EOF from the renderer. The Python/process-graph path passes, but this
environment could not rebuild the changed Rust source. Do not rely on the retained
older binary for native-supervised rendering until clean CI passes the uninjected
test. See the [current verification](../../docs/arc-science/renderer-containment-verification-2026-09-09.md).

A small Rust CLI for configuring and supervising the existing Python scientific
worker. Commands: `init`, `config`, `doctor`, `serve`, `worker`, and
`bioart`; global
`--project <existing-directory>`. No GUI, browser engine, scientific rewrite,
installer, automatic download, or startup network call is included. Tauri is a
possible later desktop-window integration, not a shipped feature.

## Build and use

Rust 1.90.0 with rustfmt/clippy is pinned in `rust-toolchain.toml`. The examples
assume Rust and an operator-provisioned virtual environment that already contains
Arc Science; they do not use global Python/system installs or download packages.
From the repository root on Linux/macOS:

```bash
cargo +1.90.0 build --release --locked --manifest-path native/arc-science/Cargo.toml
mkdir -p arc-project
native/arc-science/target/release/arc-science-native --project arc-project \
  init --python "$PWD/apps/arc-science/.venv/bin/python"
```

On Windows PowerShell, the portable config/doctor/generic-worker path is:

```powershell
cargo +1.90.0 build --release --locked --manifest-path native/arc-science/Cargo.toml
New-Item -ItemType Directory -Force arc-project | Out-Null
& native/arc-science/target/release/arc-science-native.exe --project arc-project `
  init --python (Resolve-Path apps/arc-science/.venv/Scripts/python.exe).Path
```

`init --python` persists one executable name or path without running, installing,
or canonicalizing it. Spaces and Unicode are supported; shell text is never
evaluated. Invalid blank, NUL, or parent-traversing relative paths are rejected
before the exclusive config file is created. With no option the default is
`python3` on Unix and `python` on Windows. Then, from the same repository root:

```bash
native/arc-science/target/release/arc-science-native --project arc-project config
native/arc-science/target/release/arc-science-native --project arc-project doctor
native/arc-science/target/release/arc-science-native --project arc-project worker -- --help
native/arc-science/target/release/arc-science-native --project arc-project serve
```

`serve` runs `<python> -m arc_science serve --host 127.0.0.1 --port 8080 --data <resolved-data>`.
Stop it with Ctrl-C. `worker -- token` shows the configured data directory's token.
`worker -- fixture --output 'output with spaces'` delegates an explicit synthetic
fixture. Put **all worker arguments after `--`**, including the worker's own
`--project` option. Arguments are passed separately; metacharacters are data, not
shell syntax. Your invoking shell still requires its normal quoting.

First-class BioArt commands delegate to the existing Python interface and provider;
the native layer does not duplicate transport, metadata, cache, or import logic:

```bash
# Explicit offline operator-supplied rendered DOM; never launches a browser.
native/arc-science/target/release/arc-science-native --project arc-project \
  bioart search antibody --search-html saved-search.html
# Cache-only unless the operator adds --allow-egress.
native/arc-science/target/release/arc-science-native --project arc-project bioart inspect 18
# Defaults to SVG and the provider-selected neutral representation.
native/arc-science/target/release/arc-science-native --project arc-project bioart fetch 18
native/arc-science/target/release/arc-science-native --project arc-project \
  bioart fetch 18 --representation 64 --format SVG --allow-egress
native/arc-science/target/release/arc-science-native --project arc-project \
  bioart verify /path/to/cache/receipt.json
native/arc-science/target/release/arc-science-native --project arc-project \
  bioart import /path/to/cache/receipt.json
```

`search`, `inspect`, and `fetch` alone accept `--allow-egress`; it is opt-in.
`verify` and `import` cannot accept it. `--search-html` conflicts with egress.
Formats preserve the Python CLI's exact accepted spellings: `svg/png/ai/eps` and
`SVG/PNG/AI/EPS`. Entry and representation IDs must be positive. Python receives
the resolved native project once, so its project and the configured cache cannot
silently diverge. Fetch/import remain limited to exact source-derived
`Public Domain` metadata, entry-bound file IDs, immutable bytes, hashes, receipts,
configured limits, and explicit egress.

The native build/config/doctor/module-help path was executed on Linux with Rust
1.90.0 and Python 3.12.13. The existing scientific dependencies were already
installed; this is not a fresh-machine install qualification. Windows/macOS CI is
configured, not executed in this Linux session. On Windows, build with Cargo as
above, use `target\release\arc-science-native.exe`, and configure the venv's
`Scripts\python.exe` (use TOML single-quoted literal paths for backslashes).
Only `.exe`/`.com` executable files are launched there, not batch/shell scripts.
The native supervisor is intended to be portable; **Windows BioArt is currently
unsupported**, because the Python cache requires POSIX no-follow filesystem APIs.
Direct native `bioart` operations fail before Python launch on Windows; native
`init`, `config`, `doctor`, and generic `worker` support remain available.
No Windows importer or scientific-worker qualification is implied by a build.
Only Linux native-to-application BioArt execution is qualified here; macOS remains
source/stdlib-matrix coverage, not an execution claim.

## Configuration contract

`init` exclusively creates `arc-science.toml` and never overwrites it. The project
directory must already exist. Schema version is 1; all generated fields are
required, and unknown fields are rejected at every table level. No credential
fields exist. Treat this file and the selected project as trusted operator input:
the configured Python executable and explicit worker arguments are executable
authority, not sandboxed content.

`config` prints validated TOML with resolved paths. Relative data, cache, and
multi-component Python paths are relative to the selected project, not the caller.
A bare Python name is resolved on PATH; relative PATH entries use the project.
Project-root aliases are canonicalized; Python symlinks retain their venv identity.
Cache paths must be strict project descendants without parent traversal or existing
symlink components. The native precheck does not replace the Python provider's
no-follow enforcement or create the cache. Data paths may be absolute. `serve`
accepts numeric loopback addresses only (`127.0.0.1`, `::1`), and ports 1–65535;
DNS hostnames such as `localhost` are rejected without resolution. Explicit
`worker` passthrough does not rewrite or restrict the Python CLI's arguments.

| BioArt field | Default | Accepted integer range | Worker environment |
| --- | ---: | ---: | --- |
| `cache_dir` | `.arc-science/bioart` | Strict project descendant | `ARC_BIOART_CACHE_DIR` |
| `max_metadata_bytes` | 8388608 | 1–67108864 | `ARC_BIOART_MAX_METADATA_BYTES` |
| `max_file_bytes` | 33554432 | 1–134217728 | `ARC_BIOART_MAX_FILE_BYTES` |
| `max_cache_bytes` | 268435456 | 1–4294967296 | `ARC_BIOART_MAX_CACHE_BYTES` |
| `metadata_ttl_seconds` | 86400 | 1–604800 | `ARC_BIOART_METADATA_TTL_SECONDS` |
| `timeout_seconds` | 30 | 1–120 | `ARC_BIOART_TIMEOUT_SECONDS` |
| `max_retries` | 2 | 0–2 | `ARC_BIOART_MAX_RETRIES` |

These seven explicit settings override corresponding inherited values. Unknown
`ARC_BIOART_*` environment names reject doctor/launch; values are never printed in
that error. `ARC_DATA_DIR` is also set to the configured data path. Other worker
environment settings remain inherited. Numeric limits require TOML integers, not
strings, floats, or booleans. There are no unimplemented configuration options.

## Lifecycle and limits

The Python CLI is a normal child launched on the supervisor's main thread. No
embedded Python worker thread, shell, PTY, detached service, or terminal handoff
is used. **Stdin is EOF**, while stdout/stderr are inherited. Interactive
credential/getpass flows are unsupported through this launcher; invoke the
existing Python CLI directly for those flows.

The pinned [process-wrap 9.0.0 std API](https://docs.rs/process-wrap/9.0.0/process_wrap/std/index.html)
provides Unix ProcessGroup and Windows JobObject containment. Signal handlers are
installed before spawn. A native single-wrapper acquisition guard owns the raw
child immediately after OS creation and before fallible post-spawn/JobObject
setup; setup failure kills and waits that child before returning an error. The
guard disarms only after wrapper acquisition succeeds, handing lifecycle ownership
to the supervisor. This closes an unguarded setup-error path in the pinned
dependency; Windows execution still requires its own qualification.
On Unix, Ctrl-C/SIGTERM/SIGHUP request group SIGTERM and
allow at most two seconds for Python cleanup; another signal skips the grace.
Then the group is force-killed and the direct child reaped. Descendants are also
terminated if the leader exits first. Windows cancellation terminates the Job
Object without Unix signal grace. Cancellation exits 130; normal child exit codes
are propagated, and Unix signal exits use `128 + signal`. Configuration/launch
errors exit 1; argument errors exit 2.

Linux stdlib fixtures establish a positive live descendant handshake, then require
bounded EOF on a FIFO whose only writer belongs to that descendant, for forced
termination and cleanup after leader exit. The graceful fixture additionally waits
its own child before publishing a reaped marker. These tests do not infer death
from inaccessible `/proc` data. Native reaps its direct Python child; orphaned Unix
grandchildren are reaped by the OS's adopter, not this non-subreaper supervisor.

The shipped figure/molecule executor owns a separate renderer session for standalone
timeouts and log isolation. Its scoped main-thread SIGINT/SIGTERM handling defers
cancellation across OS-child acquisition, then kills the renderer group and waits
its direct child before exit. Setup failures also enter that cleanup. Caller signal
handlers are restored; BioArt alarm/deadline state is unchanged.

For a native launch, the supervisor overrides `ARC_NATIVE_CONTAINMENT` with a
versioned process-group/job marker. On POSIX, Python accepts that marker only when
its PID is also its process-group ID. It then keeps the renderer in the outer
container and kills the direct renderer during cooperative cleanup; native kills
any remaining group/job descendants when Python exits or the grace period is
forced. Standalone or mismatched-marker execution retains the isolated renderer
session. The application lifetime tests use a real native → Python → executor chain,
positive FIFO readiness, bounded EOF and direct-renderer `ECHILD` evidence. The new
force test holds Python before its cleanup and sends two signals, so only native
containment can close the renderer's sole-writer FIFO. This is process-lifecycle
evidence, not Blender or scientific qualification; clean updated-binary execution
is still required as described in I1 above.

A child that deliberately escapes its owner's process group is outside this
trusted-worker contract. SIGKILL/crash
of the supervisor and OS-uninterruptible process states cannot promise graceful
cleanup or a fixed reap deadline. Windows/macOS execution remains pending.

The owned production BioArt HTTPX transport runs in a spawned Python subprocess.
Its POSIX main-thread parent deadline covers setup, native DNS, headers, body,
retries, and bounded result publication; timeout/cancellation kills and reaps the
transport before cleanup. Trusted injected HTTPX clients instead use an available,
unblocked POSIX alarm and do not offer the arbitrary-native-code guarantee. These
provider distinctions are preserved; native launch does not authorize egress.
See [BioArt provider details](../../apps/arc-science/docs/bioart.md).
SVG safety/import eligibility requires the application's `vector` optional
dependency set, including `defusedxml`. A base-only environment preserves an
otherwise valid SVG original but reports it as download-only; actual SVG import is
not qualified without that explicitly provisioned dependency set. AI/EPS stay
download-only and PNG stays preview-only.

`doctor` checks configured/local executable availability without running the
executables, importing packages, making network requests, or installing anything.
Python dependencies and worker functionality remain unprobed; use the module-help
command after explicit setup. Blender/Lean are optional and only reported as
available/missing on PATH. No scientific validation or model-provider qualification
is inferred.

## Tests

```bash
cd native/arc-science
cargo fmt --check
cargo test --locked --offline
cargo clippy --locked --offline -- -D warnings
cargo build --release --locked --offline
```

Tests run a deterministic local Python-stdlib module fixture, not mocked spawning.
Python 3 must be on PATH (`python3` on Unix, `python` on Windows), or set
`ARC_NATIVE_TEST_PYTHON` to an explicit executable. Linux process-tree tests use
local FIFOs and signals; they do not make network requests or run scientific work.
The stdin test keeps the supervisor's pipe writer open until bounded worker exit,
so inheriting input cannot accidentally pass. Acquisition tests cover setup-error
live-child/reaping checks and a successful child that exits before the post-spawn hook.
For application integration, build the debug native binary first, then run
`PYTHONPATH=src python -m pytest tests/test_render_lifetime.py tests/test_native_bioart.py -q` from
`apps/arc-science` using the application Python environment. Without that binary,
the native integration cases explicitly skip; standalone cases still run.
The Linux module-entrypoint CI job builds and checks that binary before running
all three test files, so a clean checkout does not silently skip native integration.
Its application environment explicitly includes the `vector` extra because the
offline synthetic SVG test verifies SVG eligibility as well as receipt/hash binding.
The Python module-entrypoint test separately runs the real worker's `--help`.

Release settings use LTO, one codegen unit, and stripping. Measurements and exact
commands are recorded in the task report; they describe native config/doctor only,
not performance of a scientific workload. No speedup is claimed without a
same-workload baseline.
