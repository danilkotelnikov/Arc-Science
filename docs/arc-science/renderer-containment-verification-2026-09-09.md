# Renderer containment continuation — 9 September 2026

**Disposition: implemented source candidate; native qualification still blocked.**
This continuation addresses inherited Important finding I1 without changing the
scientific example, renderer styling, BioArt policy or user interface. Production
source commits are `7e257fbedc2097f48739c1de6a7226e84ab854b1` and
`e88269340e29279e43378dc85cae44ad0955d06c`, based on the reviewed BioArt setup
checkpoint `cda462854ec1c857c174070dc3e98dee8556a767`.

## Root cause and contract

Native owns Python through a Unix process group or Windows Job Object. The Python
executor previously launched the renderer with `start_new_session=True`, so the
renderer escaped the Unix group. A first native signal asked Python to clean up;
a second signal immediately killed the Python group. If Python was still between
renderer acquisition and its next cancellation check, no remaining owner could
reach the detached renderer.

The source fix makes the boundary explicit:

1. Native overrides `ARC_NATIVE_CONTAINMENT` with `process-group-v1` on Unix or
   `job-object-v1` on Windows.
2. POSIX Python requires both the exact marker and `getpgrp() == getpid()` before
   trusting outer containment. Missing, wrong or topology-inconsistent markers
   retain standalone isolation.
3. A supervised renderer stays in the native container. Python kills its direct
   child for cooperative cleanup; native kills remaining descendants when Python
   exits or force cancellation occurs.
4. Standalone POSIX execution continues to create and kill a private renderer
   session, preserving the existing timeout/descendant behavior.

This matches the pinned wrapper contract: `ProcessGroup::leader()` establishes a
group and wrapped kill targets the process group. The application does not treat
that mechanism as cgroup-style containment of a child that deliberately creates a
new session.

## Test-first evidence

The regression uses real processes, not a mocked launcher. A stdlib renderer opens
a FIFO as its sole writer. The fixture blocks Python after `Popen` ownership but
before cancellation cleanup; the test observes a positive live PID handshake,
sends SIGTERM twice to native, then requires bounded FIFO EOF and native exit 130.

| Check | Result | Interpretation |
|---|---|---|
| New double-signal test against retained native binary, no marker | **Failed as expected:** `renderer survived repeated native cancellation` | Reproduced I1 before enabling the new contract |
| Same real process graph with `ARC_NATIVE_CONTAINMENT=process-group-v1` | 1 passed in 0.45 s | Exercises the changed Python policy with the older native binary supplying the future marker externally |
| Complete renderer-lifetime file with marker | 11 passed in 3.51 s | Cooperative acquisition/setup, handler restoration, marker/topology rejection and force containment |
| Complete Arc application suite with marker | 559 passed, 6 skipped in 45.66 s | All available application tests; six existing explicit Blender-runtime skips |
| Python bytecode compilation and `git diff --check` | Passed | Syntax/whitespace checks only |

The full application run used Python 3.12.14 in a project-local environment. Its
dependencies were reconstructed from retained packages plus the current runtime.
It made no live NIH, BioRender, model-provider or Blender request. The environment
marker was injected because the retained native executable predates this source
change; that run is not evidence that the Rust half compiled or emitted it.

## Remaining gate

No `cargo`, `rustc` or `rustup` executable is available in this runtime. The
authenticated GitHub connector can read `danilkotelnikov/vedix`, but creating the
`Arc-Science` development ref returned HTTP 403 (`Resource not accessible by
integration`), so its configured Rust 1.90 Linux/Windows/macOS workflow could not
be triggered. Network approval for installing another local dependency source was
also unavailable; no permission bypass was attempted.

Before I1 can be closed, a clean checkout must run:

```bash
cargo +1.90.0 fmt --check --manifest-path native/arc-science/Cargo.toml
cargo +1.90.0 test --locked --manifest-path native/arc-science/Cargo.toml
cargo +1.90.0 clippy --locked --manifest-path native/arc-science/Cargo.toml -- -D warnings
cargo +1.90.0 build --locked --manifest-path native/arc-science/Cargo.toml
cd apps/arc-science
python -m pip install '.[test]'
python -m pytest tests/test_render_lifetime.py -q -rs
```

The final test must run without externally injecting `ARC_NATIVE_CONTAINMENT`, so
the rebuilt native executable itself proves both contract halves. Until then this
remains an unmerged development checkpoint. The inherited root-suite 24-failure
maintenance item is unchanged and separately documented.
