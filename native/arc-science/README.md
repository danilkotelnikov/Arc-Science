# Arc Science native supervisor

A small Rust CLI for configuring and supervising the existing Python scientific
worker. Commands: `init`, `config`, `doctor`, `serve`, `worker`; global
`--project <existing-directory>`. No GUI, browser engine, scientific rewrite,
installer, automatic download, or startup network call is included. Tauri is a
possible later desktop-window integration, not a shipped feature.

## Build and use

Rust 1.90.0 with rustfmt/clippy is pinned in `rust-toolchain.toml`. Install the
toolchain using your normal Rust setup if needed. From the repository root:

```bash
cargo +1.90.0 build --release --locked --manifest-path native/arc-science/Cargo.toml
python3.12 -m venv apps/arc-science/.venv
apps/arc-science/.venv/bin/python -m pip install ./apps/arc-science
mkdir arc-project
native/arc-science/target/release/arc-science-native --project arc-project init
```

Edit `arc-project/arc-science.toml`: set `worker.python` to the **absolute path**
of `apps/arc-science/.venv/bin/python` (one executable, not a shell command).
The default is `python3` from PATH; an activated environment is another option.
Then, from the same repository root:

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

The native build/config/doctor/module-help path was executed on Linux with Rust
1.90.0 and Python 3.12.13. The existing scientific dependencies were already
installed; this is not a fresh-machine install qualification. Windows/macOS CI is
configured, not executed in this Linux session. On Windows, build with Cargo as
above, use `target\release\arc-science-native.exe`, and configure the venv's
`Scripts\python.exe` (use TOML single-quoted literal paths for backslashes).
Only `.exe`/`.com` executable files are launched there, not batch/shell scripts.
The native supervisor is intended to be portable; **Windows BioArt is currently
unsupported**, because the Python cache requires POSIX no-follow filesystem APIs.
No Windows importer or scientific-worker qualification is implied by a build.

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
handlers are restored; BioArt alarm/deadline state is unchanged. The application
lifetime tests exercise real native → Python → this executor with a stdlib renderer,
positive FIFO readiness, bounded EOF and direct-renderer `ECHILD` evidence, including
SIGTERM injected at acquisition/setup boundaries. This is not Blender qualification.

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
cargo test --locked
cargo clippy --locked -- -D warnings
cargo build --release --locked
```

Tests run a deterministic local Python-stdlib module fixture, not mocked spawning.
Python 3 must be on PATH (`python3` on Unix, `python` on Windows), or set
`ARC_NATIVE_TEST_PYTHON` to an explicit executable. Linux process-tree tests use
local FIFOs and signals; they do not make network requests or run scientific work.
The stdin test keeps the supervisor's pipe writer open until bounded worker exit,
so inheriting input cannot accidentally pass. Acquisition tests cover setup-error
live-child/reaping checks and a successful child that exits before the post-spawn hook.
For renderer integration, build the debug native binary first, then run
`PYTHONPATH=src python -m pytest tests/test_render_lifetime.py -q` from
`apps/arc-science` using the application Python environment. Without that binary,
the three native integration cases explicitly skip; standalone cases still run.
The Linux module-entrypoint CI job builds and checks that binary before running
both test files, so a clean checkout does not silently skip native integration.
The Python module-entrypoint test separately runs the real worker's `--help`.

Release settings use LTO, one codegen unit, and stripping. Measurements and exact
commands are recorded in the task report; they describe native config/doctor only,
not performance of a scientific workload. No speedup is claimed without a
same-workload baseline.
