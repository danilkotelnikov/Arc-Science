# Task 2 report — native configuration and process supervision

Status: DONE_WITH_CONCERNS (platform qualification limits below; independent review pending).
Starting HEAD: `b18cf58931bfebaa54def0f8b79555d82a943af6`, branch
`arc-science-development`. This task adds no scientific calculations, changes no
Vedix plugin/frozen figure assets, and makes no live NIH requests, browser attempts,
pushes, installs requiring new privileges, shell/PTY worker launches, or subagent calls.

## Implementation and owned files

- `native/arc-science/Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`: Rust1.90,
  exact direct dependency versions, locked transitive resolution; release LTO,
  one codegen unit, stripping. No GUI/browser engine.
- `native/arc-science/src/{main,lib,config,process}.rs`: `arc-science-native`
  commands init/config/doctor/serve/worker with global `--project`. Exclusive
  `arc-science.toml`, schema1, strict unknown-field/type/limit rejection; numeric
  loopback binding; project-relative data/cache/Python resolution; cache strict
  descendant and no existing symlink components. No secret schema fields.
- `native/arc-science/tests/config_cli.rs`, `tests/process_cli.rs`,
  `tests/fixtures/worker.py`: real executable/module/argv and process-tree tests.
- `native/arc-science/README.md`, `.gitignore`: setup, explicit bridge/defaults/caps,
  lifecycle/terminal/platform limits; controller approved `/target/` ignore addition.
- `.github/workflows/arc-native.yml`: Linux/Windows/macOS source build/test matrix,
  separate Linux real Python module-help test. CI configured, not executed here.
- `apps/arc-science/src/arc_science/__main__.py` and
  `apps/arc-science/tests/test_module_entrypoint.py`: delegation to the existing
  CLI and a fresh-process help regression. No CLI/scientific implementation edited.
- Root `README.md`: native build/init/configuration/doctor/module-help/serve setup.
- This report. No controller development-status/decisions/legacy-verification files staged.

Read Task2 brief first, Task1 final bridge/deadline/TMPDIR report and actual
`bioart/models.py`/`bioart/cli.py`/`cli.py`. Rust defaults match Python exactly:
8388608,33554432,268435456 bytes;86400s TTL;30s timeout;2 retries. Caps match
67108864,134217728,4294967296 bytes;604800s;120s;2; minima1 except retries0.
Seven recognized ARC_BIOART variables are set explicitly; cache is resolved under
the project, unknown bridge names fail before doctor/launch, and ARC_DATA_DIR is
set. Existing configured values override corresponding inherited bridge values.
No unused settings or unrecognized bridge variable were introduced.

Normal `/root/.cargo/bin/cargo info process-wrap@9.0.0` resolution reported
version9.0.0/MSRV1.86.0; Cargo resolved67 locked packages compatible with Rust1.90.
Read the actual downloaded std ProcessGroup/JobObject/core/windows implementation
and [official std API](https://docs.rs/process-wrap/9.0.0/process_wrap/std/index.html).
Used `CommandWrap::from`, Unix `ProcessGroup::leader`, Windows `JobObject`,
`spawn`, `try_wait`, `signal`, `start_kill`, and `wait`; not deprecated command-group.

Supervisor installs cancellation handlers before acquiring the child handle,
launches `<python> -m arc_science <argv...>` normally on the main thread with
null stdin and inherited stdout/stderr, and polls every20ms. Unix cancellation
requests group SIGTERM, allowing up to2seconds cleanup; another signal skips
grace. Group hard kill and direct-child wait follow. Leader exit also triggers
group cleanup. Windows uses JobObject termination without Unix grace. Native
cancellation exits130, other child codes propagate; Unix child-signal exit is
128+signal. Unknown/missing configuration/executables fail clearly without install.

Doctor only checks local executable presence/executable bits: Python configured
and resolved, optional Blender/Lean; package imports explicitly unprobed. It
states no scientific validation, no network/egress grant, Windows BioArt unsupported,
and distinguishes owned POSIX main-thread subprocess deadlines from trusted
injected HTTPX/POSIX-alarm restrictions. No worker qualification inferred.

## Exact RED/GREEN evidence

Native cwd for commands below:
`/workspace/scratch/0894be2b5454/vedix-arc-science/native/arc-science`.

1. Config tests first; initial executable was an empty `fn main() {}` scaffold.

   RED: `/root/.cargo/bin/cargo test --test config_cli`

   Exit101; `0 passed; 5 failed; ... finished in 0.00s`. All5 failed as expected:
   missing config was incorrectly successful; initialization created no config;
   path/default fixtures had no file; symlink config was incorrectly successful.
   Production config/parser implementation then added.

   GREEN: `/root/.cargo/bin/cargo test --locked --test config_cli`

   Exit0; `5 passed; 0 failed; ... finished in 0.07s`.
   Coverage: exclusive/no-overwrite init, missing project/config with no creation,
   schema/unknown fields at all3levels, invalid ports, nonloopback/DNS hosts,
   each over-cap numeric limit, zero timeout, float/bool/negative rejection,
   invalid cache/empty Python, spaces/Unicode project, IPv6 loopback, retries0,
   project data/cache resolution, cache symlink rejection.

2. Process tests first, while parser supported only init/config.

   RED: `ARC_NATIVE_TEST_PYTHON=/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python /root/.cargo/bin/cargo test --locked --test process_cli`

   Exit101; `0 passed; 12 failed; ... finished in 5.01s`. Failures: missing
   doctor/serve/worker commands, absent help commands, wrong exit codes, missing
   fixture records for lifecycle tests. No spawn mock; Python fixture was real.
   Added process supervisor and the three command branches.

   GREEN: same exact command; exit0;
   `12 passed; 0 failed; ... finished in 2.09s`.
   Covers preserved argv (spaces, Unicode, metacharacters, literal worker --project
   and --help), exact settings bridge and precedence, cwd/data path, stdin EOF,
   inherited stdout/stderr, no shell-marker file, serve argv, exit23, missing
   worker args/Python, unknown bridge rejection before spawn, no-execution doctor,
   relative executable path/venv symlink, signal exit143, three Linux lifecycle cases.

3. Python cwd:
   `/workspace/scratch/0894be2b5454/vedix-arc-science/apps/arc-science`.

   RED: `PYTHONPATH=src /workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python -m pytest tests/test_module_entrypoint.py -q --tb=short`

   Exit1; `1 failed in 0.04s`; exact cause:
   `No module named arc_science.__main__; 'arc_science' is a package and cannot be directly executed`.
   Added only the delegating package entrypoint.

   GREEN: same exact command; exit0; `1 passed in 0.27s`.

## Full native check

Ran once after implementation, native cwd:

```bash
/root/.cargo/bin/cargo fmt --check && ARC_NATIVE_TEST_PYTHON=/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python /root/.cargo/bin/cargo test --locked && /root/.cargo/bin/cargo clippy --locked -- -D warnings && /root/.cargo/bin/cargo build --release --locked
```

Combined exit0. Formatting no output; config5passed in0.06s; process12passed
in2.07s; unit/doc harnesses contain0tests, all successful. Clippy finished clean
in2.81s; release optimized build finished in16.03s. `git diff --check` clean.
No broad scientific/frontend/legacy suite rerun by this task.

Post-check test-only portability refinement canonicalizes the observed real cwd
before path comparison (Windows verbatim path spelling is not a different directory).
No production source changed. Focused fmt/process test rerun is recorded below.

Real release-to-real-worker check from repository root:

```bash
PYTHONPATH=/workspace/scratch/0894be2b5454/vedix-arc-science/apps/arc-science/src native/arc-science/target/release/arc-science-native --project /tmp/arc-native-measure-ZdgtOl worker -- --help
native/arc-science/target/release/arc-science-native --project /tmp/arc-native-measure-ZdgtOl doctor
```

Both exit0. Actual Arc Science help lists serve, bioart and retained commands;
doctor Python available at the explicit3.12.13 venv path, Blender/Lean missing,
scientific validation not performed, imports not probed. No service/listener,
worker computation, BioArt request, or UI preview started.

## Linux lifecycle evidence and concerns

- `ctrl_c_allows_python_to_reap_its_transport`: real Python leader spawns a child;
  native receives SIGINT; leader handles forwarded SIGTERM, kills/waits its child,
  writes a `reaped` marker. Test verifies marker, native exit130, both worker and
  descendant non-running.
- `sigterm_force_kills_unresponsive_process_tree`: leader ignores SIGTERM and
  spawns a descendant; native receives SIGTERM, forces group kill after2s,
  exits130; neither leader nor descendant remains running.
- `leader_exit_does_not_abandon_descendant`: leader exits7 while child remains;
  supervisor preserves exit7 and kills the descendant.
- Linux tests wait at most6seconds including fixture startup and check `/proc/PID/stat`:
  absent or zombie is non-running. Direct worker is waited/reaped. A force-orphaned
  grandchild's zombie reaping belongs to the OS adopter; the launcher is not a
  Linux-specific subreaper and does not claim to reap all descendant PIDs.
- Ctrl-C/termination acquisition handling is coded before spawn, not race-injected
  in a deterministic native test. Deliberate group escape, supervisor SIGKILL/crash,
  and OS-uninterruptible waits are outside the cleanup/deadline guarantee.
- No interactive terminal handoff/getpass; stdin EOF is deliberate and tested.
- Windows/macOS source CI remains unexecuted. JobObject behavior and platform
  dependency/runtime imports require their own validation. Windows BioArt remains
  unsupported regardless of native compilation.
- Doctor is presence-only and may report an executable which later fails to run;
  launch then fails clearly. This is not dependency or scientific qualification.
- Config/project/Python are trusted operator input, not a sandbox. Native cache
  prechecks do not weaken/replace Task1 no-follow filesystem protection; no cache
  or source path is canonicalized into acceptance. Only project root is resolved.

## Linux measurements

Environment: Linux `6.18.35 #1 SMP Mon Aug 31 18:10:37 UTC 2026`, x86_64,
host target `x86_64-unknown-linux-gnu`, AMD EPYC9V74 80-Core Processor,
reported MemTotal22568272KiB (shared/containerized environment, no CPU pinning).
Rustc1.90.0 `1159e78c4` (2025-09-14), LLVM20.1.8; Cargo1.90.0 `840b83a10`;
Python3.12.13. Existing C compiler Ubuntu GCC13.3.0.

Binary: `native/arc-science/target/release/arc-science-native`, **1166320 bytes**,
SHA256 `f3cfe6e8abdfb55ce7526bb57ab77fab54aa72ff87ecaf7965ac1c396a23f15c`.
Commands: `stat -c '%s bytes' native/arc-science/target/release/arc-science-native`
and `sha256sum native/arc-science/target/release/arc-science-native`.

Project created with `mktemp -d /tmp/arc-native-measure-XXXXXX`, returned
`/tmp/arc-native-measure-ZdgtOl`; release `--project ... init` ran successfully.
Only generated worker.python changed (using apply_patch) to the explicit
`/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python`; all
other defaults retained. No cache/data was created. Measurement commands make
no child worker, network request, import, or scientific calculation.

GNU `/usr/bin/time` was absent (exit127); no install attempted. Two initial Python
wait4 runs (Popen then forced posix_spawn; each3warmups+30samples per command)
reported roughly11.6MiB child high-water RSS, evidently contaminated by the Python
launch image. Those are **not** treated as native-only memory measurements. Final
measurements use a small C launcher, eliminating the large Python launch image.
Transient harness source is reproduced below, so no hidden script is needed.

Final commands, repository-root cwd (both exits0):

```bash
cc -O2 -Wall -Wextra -Werror /workspace/scratch/0894be2b5454/native-measure.c -o /workspace/scratch/0894be2b5454/native-measure
/workspace/scratch/0894be2b5454/native-measure /workspace/scratch/0894be2b5454/vedix-arc-science/native/arc-science/target/release/arc-science-native /tmp/arc-native-measure-ZdgtOl config
/workspace/scratch/0894be2b5454/native-measure /workspace/scratch/0894be2b5454/vedix-arc-science/native/arc-science/target/release/arc-science-native /tmp/arc-native-measure-ZdgtOl doctor
```

Each command:3discarded warmups then30samples, serial processes, inherited
environment, stdout/stderr `/dev/null`. Elapsed is CLOCK_MONOTONIC across
posix_spawn+wait4 (includes launch/scheduling overhead); peak RSS is that child's
Linux wait4 ru_maxrss inKiB, not cumulative getrusage subtraction, allocator-only
usage, or a worker tree. Page cache/OS scheduling were not controlled.

| Native command | Elapsed min / median / max (ms) | Peak RSS min / median / max (KiB) |
| --- | ---: | ---: |
| config | 0.730451 / 0.8863565 / 2.009953 | 1676 / 1792 / 1832 |
| doctor | 0.810704 / 0.888785 / 1.139751 | 1676 / 1764 / 1832 |

No speedup comparison exists: no same-workload baseline was run. These are
native command measurements, not scientific-worker performance or qualification.

### Raw final samples

| Sample | Config ms | Config KiB | Doctor ms | Doctor KiB |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1.069382 | 1792 | 0.884058 | 1792 |
| 2 | 0.871589 | 1804 | 0.906241 | 1832 |
| 3 | 0.948764 | 1676 | 0.896957 | 1680 |
| 4 | 0.903933 | 1792 | 1.007380 | 1800 |
| 5 | 0.879962 | 1764 | 0.981337 | 1800 |
| 6 | 1.049223 | 1764 | 0.863348 | 1764 |
| 7 | 0.906411 | 1800 | 0.883377 | 1680 |
| 8 | 2.009953 | 1832 | 0.990616 | 1784 |
| 9 | 0.990555 | 1764 | 0.874294 | 1676 |
| 10 | 0.892751 | 1676 | 0.827003 | 1804 |
| 11 | 0.926651 | 1680 | 0.899070 | 1792 |
| 12 | 0.772563 | 1792 | 0.857588 | 1680 |
| 13 | 0.775668 | 1680 | 0.935044 | 1680 |
| 14 | 0.761627 | 1792 | 1.139751 | 1676 |
| 15 | 0.753585 | 1792 | 0.909716 | 1764 |
| 16 | 0.876076 | 1792 | 0.810704 | 1788 |
| 17 | 0.898680 | 1800 | 0.830408 | 1792 |
| 18 | 0.758532 | 1792 | 0.864890 | 1676 |
| 19 | 0.771662 | 1800 | 0.854564 | 1832 |
| 20 | 0.749488 | 1676 | 0.897859 | 1792 |
| 21 | 0.865290 | 1804 | 0.849867 | 1792 |
| 22 | 0.730451 | 1792 | 1.023144 | 1676 |
| 23 | 0.771021 | 1792 | 0.834735 | 1792 |
| 24 | 1.112616 | 1676 | 0.859502 | 1680 |
| 25 | 0.967050 | 1796 | 0.889867 | 1676 |
| 26 | 0.866672 | 1792 | 0.881819 | 1676 |
| 27 | 0.940982 | 1832 | 0.935043 | 1792 |
| 28 | 0.844039 | 1800 | 1.046838 | 1676 |
| 29 | 0.914243 | 1792 | 1.026999 | 1676 |
| 30 | 1.005558 | 1768 | 0.887703 | 1680 |

### Reproducible measurement harness

```c
#define _GNU_SOURCE
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

int main(int argc, char **argv) {
    if (argc != 4) return 2;
    char *child_argv[] = {argv[1], "--project", argv[2], argv[3], NULL};
    posix_spawn_file_actions_t actions;
    if (posix_spawn_file_actions_init(&actions) ||
        posix_spawn_file_actions_addopen(&actions, 1, "/dev/null", O_WRONLY, 0) ||
        posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0)) return 3;
    for (int index = 0; index < 33; index++) {
        struct timespec started, ended;
        struct rusage usage;
        pid_t pid;
        int status;
        if (clock_gettime(CLOCK_MONOTONIC, &started) ||
            posix_spawn(&pid, argv[1], &actions, NULL, child_argv, environ) ||
            wait4(pid, &status, 0, &usage) != pid ||
            clock_gettime(CLOCK_MONOTONIC, &ended)) return 4;
        if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return 5;
        double ms = (ended.tv_sec - started.tv_sec) * 1000.0 +
                    (ended.tv_nsec - started.tv_nsec) / 1000000.0;
        if (index >= 3) printf("%s,%d,%.6f,%ld\n", argv[3], index - 2, ms, usage.ru_maxrss);
    }
    posix_spawn_file_actions_destroy(&actions);
    return 0;
}
```

## Self-review and handoff

Superpowers TDD controlled the work: config and process tests were observed RED
before implementation; package entrypoint test failed for the missing module before
adding delegation. Verification-before-completion required observed check output
before the commit. Self-review checked scope, explicit argv/env alignment with real
Python models, unknown fields, loopback/path checks, EOF streams, child lifecycle,
venv symlink identity, exit/error behavior, no live/network actions, and documentation
claims. Tests exercise real Python processes and controlled files, not mocked spawn
calls. Controller owns independent review; none was spawned by this task.

After the test-only cwd canonicalization refinement, ran:
`/root/.cargo/bin/cargo fmt && /root/.cargo/bin/cargo fmt --check && ARC_NATIVE_TEST_PYTHON=/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python /root/.cargo/bin/cargo test --locked --test process_cli`.
Result: exit0,12passed in2.08s. Production binary unchanged from fullcheck/measurements.

Known limitations are explicit, not blockers silently worked around: Windows/macOS
unexecuted; Windows BioArt unsupported; noninteractive only; trusted process-group
contract; OS-adopter zombie reaping; presence-only doctor; scientific/live-provider/
UI/Blender qualification not performed. No speedup claimed. All original Vedix and
scientific asset paths were left untouched; only the new Python entrypoint/test
were added to the application. No push.

Commit: task implementation/report committed together; see the commit containing
this report (hash also returned in the handoff). No unrelated controller files included.

## Fix round 1 — own the child across fallible containment setup

Starting HEAD `177921c` (controller documentation); original native implementation
`c87b1788cf9a66b65e62c4f2d135499f98501b92`. Read the full saved
`task-2-review.md`. Its Important finding is verified against pinned source:
`CommandWrap::spawn` creates a raw child before `post_spawn`/`wrap_child`; Windows
JobObject sets CREATE_SUSPENDED, then fallible job assignment/resumption may fail
while no native ChildGuard exists. Dropping raw Child does not kill or wait it.

Normal `/root/.cargo/bin/cargo info process-wrap@9.1.0` downloaded compatible
9.1.0 (MSRV1.87) for inspection only. Its pipeline and JobObject have the same
gap; production remains pinned9.0.0. No registry/cache modification, vendoring,
raw Windows handle duplication, new privilege, external sync, or subagent.

### Changes

- Added small `native/arc-science/src/acquire.rs`, exported by `src/lib.rs` and
  called by `src/process.rs` instead of the dependency's generic spawn pipeline.
  It drives the actual single ProcessGroup OR JobObject public hooks in order:
  pre_spawn, OS spawn, post_spawn, wrap_child. Actual wrappers do not require
  sibling-wrapper state; the empty context is deliberate, not a replacement
  general multi-wrapper framework.
- A raw Child is captured in an infallible RAII struct immediately after OS spawn,
  before any post_spawn or wrap_child setup. The guarded ChildWrapper is consumed
  by JobObject; an error during setup/resumption drops it, invoking raw kill and
  wait before error return. No unsafe filesystem/Windows workaround was added.
- Guard arming state is allocated before spawning. It disarms only after wrapping
  succeeds and the returned child passes to the existing supervisor guard. This
  also avoids a raw-PID kill on later drop after ProcessGroup has already reaped
  the child through waitpid. Existing graceful/forced group lifecycle is unchanged.
- Added `tests/acquisition.rs`: both failing-hook paths around a real Python
  sleeper, plus success hook-order/environment/exit delegation. Unix tests assert
  Child::try_wait is None inside the hook (real created/live child), and same-parent
  waitpid(WNOHANG) returns ECHILD after failure, proving prior reap rather than
  just termination/zombie state. Test-only RED cleanup kills AND waits a survivor.
- Added exact Unix dev dependency nix0.30.1 with process/signal features; it was
  already transitively locked. Cargo.lock gains only the root dependency edge.
- Native README describes acquisition ownership and unchanged Windows limits.
- All-target Clippy exposed an existing nested-if lint in tests/process_cli.rs;
  converted that one nested file-read/JSON parse into an equivalent let-chain.
  No EOF/lifecycle assertion semantics changed in this fix round.

### TDD and exact output

Cwd for all commands:
`/workspace/scratch/0894be2b5454/vedix-arc-science/native/arc-science`.

The first regression attempt used immediate /proc/PID absence as its assertion
and unexpectedly produced2passes against the still-unfixed dependency path
(`cargo test --locked --test acquisition`,0.00s). This was rejected as a false
GREEN before adding a fix. A temporary forwarding acquisition function still
called the original CommandWrap::spawn, ensuring the improved tests exercised
the leak. Its harmless unused-mut warning was removed. Tests were strengthened
to a live Child::try_wait at the hook plus same-parent waitpid/ECHILD afterward.

RED command (offline only because adding an already-cached direct dev dependency
updates the lock's root edge):

```bash
ARC_NATIVE_TEST_PYTHON=/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python /root/.cargo/bin/cargo test --offline --test acquisition
```

Exit101; `0 passed; 2 failed; ... finished in 0.00s`. Both exact failures:
`created child must be killed AND reaped before error return`, actual
`Ok(StillAlive)`, expected `Err(ECHILD)`. Both real survivors killed/waited by
test-only cleanup; no leaked fixture left by the corrected RED tests.

After implementing acquisition ownership, GREEN command:

```bash
/root/.cargo/bin/cargo fmt && ARC_NATIVE_TEST_PYTHON=/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python /root/.cargo/bin/cargo test --locked --test acquisition
```

Exit0; `3 passed; 0 failed; ... finished in 0.12s`. Success case verifies hooks
pre/post/wrap, propagated environment and real child exit23, not just mock calls.

First covering command used fmt check, the3native integration suites,
`cargo clippy --locked --all-targets -- -D warnings`, then release build.
Tests passed3+5+12; Clippy stopped before build for new guard collapsible_if.
Changed the guard to an early return. The next all-target Clippy exposed the
pre-existing nested-if test lint; applied the behavior-preserving let-chain above.

Final covering command:

```bash
/root/.cargo/bin/cargo fmt && /root/.cargo/bin/cargo fmt --check && ARC_NATIVE_TEST_PYTHON=/workspace/scratch/0894be2b5454/arc-science/arc-science/.venv/bin/python /root/.cargo/bin/cargo test --locked --test acquisition --test process_cli --test config_cli && /root/.cargo/bin/cargo clippy --locked --all-targets -- -D warnings && /root/.cargo/bin/cargo build --release --locked
```

Combined exit0: acquisition3passed in0.12s; config5passed in0.06s;
process12passed in2.09s; all-target Clippy clean in0.16s; release build clean
in9.93s. `git diff --check` clean. No broad application, scientific, frontend,
legacy, network, or cross-platform suite run. Previous timing/RSS samples and
binary hash earlier in this report describe the original c87b178 build only;
timing/RSS were not rerun for this acquisition fix.

Affected release size check (`stat -c '%s bytes'` and `sha256sum` on
`native/arc-science/target/release/arc-science-native`, repository-root cwd):
**1163080 bytes**; SHA256
`66ad72ca36695d22ff83d7ae80530a3ba8b55e3987f51f7ec9c2a62579c0a8c2`.

### Remaining review concerns and self-review

Windows JobObject setup/resumption branch remains source-reviewed, not executed.
The injected actual failure paths execute on Linux; the Unix ECHILD tests are
configured for macOS too but not run there. Kill/wait follows OS process semantics,
not a new guarantee about uninterruptible waits or arbitrary external permissions.

Observed /proc false-absence is important evidence against overclaiming the
earlier forced-descendant/leader-exit tests: a child reported absent from the
process directory was demonstrably StillAlive to its actual parent. Controller
was notified and will carry stronger descendant-lifetime assertions to whole-branch
review. Those existing tests were not semantically expanded in this bounded fix.
The review's separate Minor EOF-test weakness also remains deferred: output()
supplies EOF itself, although production correctly uses Stdio::null. Do not
interpret covering-suite success as independently resolving either deferred issue.

Self-review verified immediate ownership, hook order against pinned public APIs,
guard survival through consuming wrap_child errors, disarm after success,
normal wrapper delegation, and untouched config/science/Vedix code. No raw child
handle escapes this acquisition path. Independent re-review belongs to controller.
