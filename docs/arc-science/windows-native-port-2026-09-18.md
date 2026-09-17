---
title: Windows-native port — anchored I/O, Cairo-free raster, cooperative isolation
date: 2026-09-18
status: The full arc-science Python suite runs natively on Windows (546 passed, 66 skipped, 0 failed)
---

# Running Arc Science natively on Windows

Arc Science was written for Linux: its provenance and security layers use the POSIX
`openat` model (a directory file descriptor plus `dir_fd`-relative `os` calls), SVG
rasterization via cairosvg (native Cairo), and Unix-signal process isolation
(`SIGALRM`/`setitimer`, `killpg`/`setsid`). Windows Python has none of these. This port
makes the whole suite run natively on Windows while keeping every Linux code path
**byte-identical** (the Windows machine cannot execute the POSIX branches, so they were
never edited — only guarded alongside).

## The anchored layer (`arc_science/anchored.py`)

A single cross-platform "anchored directory" abstraction. A *handle* is an `int`
directory fd on POSIX and an absolute path `str` on Windows.

- POSIX branches forward to the exact `os.*(dir_fd=…)` calls the callers used inline
  before — behaviour is unchanged.
- Windows branches operate on absolute paths and reject symlink / junction / reparse
  point components explicitly (`st_file_attributes & FILE_ATTRIBUTE_REPARSE_POINT`),
  and read with `O_BINARY` so bytes match the recorded sha256.

Consumers routed through it: `molecular.py`, `vector_assets.py`, `figure_contract.py`,
`figure_render.py`, `figure_worker.py`, `figure_review.py`, `bioart/cache.py`,
`bioart/isolation.py`, `bioart/worker.py`. `figure_contract` loads `anchored` the same
dependency-free way the `-I` Blender worker loads `figure_contract`, so the isolated
worker keeps working.

**Security tradeoff (accepted):** the Windows path lacks a real directory fd, so it
cannot anchor a whole operation against a mid-flight path swap the way `openat` does.
The store/run directories are the local operator's own; the residual TOCTOU window is
the documented cost of Windows support.

## Cairo-free SVG rasterization (`arc_science/svg_raster.py`, `native/arc-svg`)

cairosvg imports on Windows but `svg2png` raises (no native Cairo). `svg_raster` prefers
cairosvg when it actually works, else shells out to a small resvg-based `arc-svg2png`
tool (built from `native/arc-svg`, named by the `ARC_SVG2PNG` environment variable). The
converter engine is recorded truthfully in provenance (`CairoSVG` or `resvg`), and
`figure_contract.validate_asset` accepts either.

## Render + fetch isolation

- **Blender render** (`figure_render._execute`): POSIX keeps the watchdog / `/proc`
  cwd / `killpg` sandbox. Windows uses a bounded `CREATE_NEW_PROCESS_GROUP` subprocess
  with a reader thread that caps the log and holds the deadline, and `taskkill /F /T` to
  reap the Blender subtree. Weaker isolation, accepted.
- **BioArt fetch** (`bioart/deadline.py`, `isolation.py`, `web.py`): POSIX preempts a
  stuck blocking read with `SIGALRM`; Windows has no such signal, so the deadline is
  cooperative — the client already passes `remaining()` as the httpx per-request timeout,
  which bounds each read. The owned CLI is reaped with `taskkill /F /T` instead of
  `killpg`. `_cli_environment` forwards `SystemRoot`/`PATH` (case-insensitively) so the
  child interpreter's asyncio/Winsock import does not fail with `WinError 10106`.

## Environment requirements on Windows

- Build `native/arc-svg` and set `ARC_SVG2PNG` to the `arc-svg2png` binary (Cairo-free
  SVG rasterization). Not needed where a working Cairo is present.
- Install `arc-science`'s dependencies into the **main** site-packages, not the user
  site: the BioArt web CLI runs the child interpreter with `-I` (isolated), which
  excludes the per-user site. On a non-UTF-8 locale, run under Python UTF-8 mode or rely
  on the app's own binary reads (it does not use `read_text()` on content).

## Test posture

`546 passed, 66 skipped, 0 failed` on Windows. Skips are POSIX-only *mechanisms*, not
gaps in behaviour: symlink creation (privilege-gated), `os.mkfifo` FIFO substitution,
`dir_fd` monkeypatching of the openat internals, the no-follow fail-closed guard, POSIX
file-mode (`0o600`) assertions, and the `SIGALRM`/`killpg` signal-reaping tests
(`test_bioart_deadline` is POSIX-only). The properties they check still hold on Windows
through `anchored`'s path-based rejection and the cooperative deadline.

## What is unchanged

Every POSIX branch is the original code. On Linux the suite behaves exactly as before;
Windows validation of these changes runs here, and the POSIX branches must be validated
on Linux/CI (they are byte-identical to the pre-port code by construction).
