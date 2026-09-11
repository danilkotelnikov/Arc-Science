# Arc 0.6 qualification continuation

Date: 2026-09-11. Product source: `847781fbb4f767cee659e2e4ca8ae9db7d920c79`.
The continuation adds qualification tooling and documentation, not a new memory
engine or a Windows BioArt implementation. Historical results remain historical.

## Four requested gates

| Gate | Fresh observation | Current conclusion |
| --- | --- | --- |
| Rust rebuild | Official Rust 1.90.0 installed; locked Linux tests, lint and optimized build succeeded; fresh executable used in Python integration and installed-wheel smoke test | Qualified for the tested Linux supervisor scope |
| Live NIH vector transfer | Real cache-empty `bioart fetch 18 --allow-egress` failed during metadata acquisition. Same direct HTTPX transport reported `ConnectError: [Errno -3] Temporary failure in name resolution` | Unqualified; no NIH vector bytes or receipt created |
| Windows BioArt intake | Native Windows MSVC-target source and tests passed `cargo check --locked --all-targets`; runtime/provider code explicitly rejects Windows | Unsupported, not merely an unrun live test; no Windows execution performed |
| Browser pixels | Local service started successfully. Managed browser navigation to `http://127.0.0.1:8080/` failed with `net::ERR_BLOCKED_BY_CLIENT` | Unqualified; no application screenshot captured |

No proxy changes, alternate-host transfer, browser download or other access-control
workaround was attempted for NIH. The failure concerns this runtime's direct DNS
path, not a conclusion that NIH is unavailable to users. The public
[NIH FAQ](https://bioart.niaid.nih.gov/faqs) and
[entry 18](https://bioart.niaid.nih.gov/bioart/18) were readable through research
tools; reading public metadata is not a successful application file transfer.

The browser's block was not classified as a site bot challenge. DOM-unit tests
and in-process HTTP tests are not browser-pixel evidence.

## Fresh checks

| Check | Result |
| --- | --- |
| Initial Python baseline, before building native | 575 passed, 11 skipped |
| Full application suite with fresh native debug executable | 580 passed, 6 explicit official-Blender-runtime skips |
| Rust tests on Linux | 31 passed (3 acquisition, 10 config, 18 process) |
| Rust formatting and strict Clippy | Passed |
| Linux release build | Passed, `--locked --offline` after dependency acquisition |
| Windows MSVC cross-target `cargo check --all-targets` | Passed; neither linked Windows binary nor execution |
| UI interaction/packaging tests | 15 passed |
| Production HeroUI build | Passed; same `index-BJv1Ui3L.js` and `index-BtWlx6y0.css` |
| Packaged wheel HTTP and hash checks | 20 public assets passed; protected routes stayed authenticated |
| Fresh release launcher to separate non-editable installed wheel | Offline init → fetch → verify → SVG import passed |

The installed-wheel check is reproducible with
`apps/arc-science/scripts/check-native-installed.py --binary ABSOLUTE_BINARY --python VENV_INTERPRETER`.
Run that script with the source test environment, and install the wheel with its
`vector` extra in the separate target interpreter. It refuses an editable/source
package probe. Its cached SVG is explicitly synthetic, SHA-256
`bc12cb08e1bdd4a377996e3ff1ef2f7064562b6cb4caa10065b5ae714c512e4f`.
It is integration evidence, not compatibility evidence for a downloaded NIH SVG.

Runtime: Linux x86-64, glibc 2.39, Python 3.12.14, SQLite 3.53.1,
Rust/Cargo 1.90.0. Python dependencies were freshly resolved within the current
project constraints; the evidence package contains that environment's freeze.
The six remaining skips require an explicitly configured official Blender/bpy
runtime. Starlette/httpx and NumPy/scikit-image deprecations, plus three HeroUI
`use client` build warnings, remain visible.

## Artifact identity

| Artifact | SHA-256 |
| --- | --- |
| Linux release executable, 1,241,608 bytes | `243c477e787621c4faa70723fc4d7c127dae5845653971f0f5b0cd7ed7e5ba64` |
| Rust Cargo.lock | `43c0ebffbfe17111de1dcb0bbcfcc84bd9d2090a48ca9cec652e9f64520f8151` |
| Fresh Arc 0.6 wheel | `4218c2ec642467b9a9d3926dc40e795b64828a4b9a4e2c1073ea7421e69ab495` |
| Unchanged 1DQJ collage | `7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9` |
| Unchanged 1DQJ source coordinates | `176f9d155fdf18650f8221007511dbde90f0fc19de9462d59515ce590bb30250` |

The executable is a stripped, dynamically linked Linux x86-64 ELF, not a Windows
or macOS build and not a standalone scientific application. Its size is not a
benchmark of Python, Blender, embedding latency or memory consumption.

## What Windows intake actually requires

The blocking implementation is identifiable: `bioart/cache.py` requires `fcntl`,
no-follow descriptors and `dir_fd`; `bioart/isolation.py`, `worker.py` and
`deadline.py` use POSIX signals; `bioart/web.py` uses POSIX process groups; and
`vector_assets.py` uses descriptor-relative validation and atomic promotion.
Removing the `os.name` guard would weaken the contract without supplying those
operations.

A portable native intake increment needs a reviewed handle-based filesystem
boundary, process-owned locking, bounded HTTP in a killable worker, crash-safe
receipt/source publication and a Windows-capable validated SVG import path.
Microsoft documents [reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)
and the behavior of
[`FILE_FLAG_OPEN_REPARSE_POINT`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew).
A final-component flag or `canonicalize` check alone is not proof against parent
directory replacement races. The threat model, trusted cache root and all path
components need explicit treatment.

Use Windows [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
for owned child-tree termination, retaining acquisition-failure cleanup. On a
real Windows runner, exercise junction/reparse/alternate-stream/device paths,
Unicode and long paths, concurrent writers, stalled DNS/body reads, repeated
cancellation, interrupted promotion, corrupt receipts and native-to-import
execution. Keep normal CI offline with labelled fixtures; make live NIH transfer
a separate bounded, consented test. Cross-compilation and WSL are not substitutes
for those Windows-native tests.

## Next development boundary

[Native session-memory proposal](native-session-memory-proposal-2026-09-11.md)
compares Arc-owned Rust storage, MemPalace-native reuse and LanceDB. It specifies
source-preserving records, local embeddings, scoped hybrid retrieval, replay
bindings, deletion and measurable latency/recall tests. It is not enabled in Arc.

GitHub sync was not retried in this turn; the last recorded integration write was
403. The original Vedix plugin and broader legacy suite were not rerun; their
earlier failures remain disclosed in `legacy-verification.md`. No scientific,
rights, full-app Windows/macOS, Lean, or autonomous-evolution qualification is
implied by this Linux build.
