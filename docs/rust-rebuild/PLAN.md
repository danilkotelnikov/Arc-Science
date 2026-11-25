# Clean-room Rust rebuild

This specification defines the full Rust implementation of Arc Harness under the MIT license. The design eliminates every dependency on DeepSeek Harness (DSH) across all versions. The build produces pure Rust source code in this repository alongside precompiled native release binaries for Windows, ARM, and Linux.

## Scope and provenance

Arc Harness runs as a standalone native application with zero reliance on `pristine/app.asar`, binary or JavaScript patching, Electron, bundled Node.js, `pnpm`, the Cordis runtime, or the Go `arc-gateway`.

Every Rust crate follows strict clean-room Chinese-wall rules:

- Specifications derive strictly from first-party MIT contracts in this repository: `wiki/Roadmap.md`, `lean/ArcValidators.lean`, `lean/ArcCheckers.lean`, `plugins/arc-*` test suites, and Change Tree `P1`–`P10` properties.
- Builders work exclusively from these written contracts and black-box behavioral tests.
- No builder reads, inspects, decompiles, or translates `pristine/app.asar` or any upstream DSH bundle.
- All new crates carry the MIT license and pass `scripts/privacy-scan.mjs`, `tools/prose-gate.mjs`, and `cargo test --locked`.

## Target platforms

Release artifacts ship as precompiled native binaries across five target triples covering Windows, Linux, and ARM workstations and servers.

| Target triple | Platform | Binary profile |
|---|---|---|
| `x86_64-pc-windows-msvc` | Windows x64 | Native MSVC executable and installer |
| `aarch64-pc-windows-msvc` | Windows ARM64 | Native MSVC ARM64 executable |
| `x86_64-unknown-linux-musl` / `x86_64-unknown-linux-gnu` | Linux x64 | Static MUSL CLI/daemon and GNU desktop binary |
| `aarch64-unknown-linux-musl` / `aarch64-unknown-linux-gnu` | Linux ARM64 | Static MUSL server binary and GNU workstation binary |
| `aarch64-apple-darwin` | macOS Apple Silicon ARM64 | Native ARM64 desktop and CLI bundle |

Build and release invariants:

- Network transport uses pure-Rust TLS (`rustls`) with zero OpenSSL C dependency.
- Every release build runs with `cargo build --release --locked` for reproducible dependency resolution.
- Each release publishes `SHA256SUMS.txt` and `RELEASE-MANIFEST.json` carrying SHA-256 digests for every target archive.
- The native updater uses a two-generation journaled rollback layout so an interrupted or failing upgrade restores the prior working generation automatically.

## Crate architecture

The Cargo workspace under `native/` organizes Arc Harness into six crates with explicit module boundaries.

### `arc-validators`

Zero-dependency Rust crate paired with `lean/ArcValidators.lean`. It implements SHA-256 hashing, the two-band prose gate, ASD-STE100 rules, privacy/hue/brand scans, hook guards, SVG bounds checks, seal guards, and network grant validation.

### `arc-hoh-core`

Deterministic Harness-of-Harness and Change Tree engine paired with `lean/ArcCheckers.lean`. It implements:

- Hash-chained SHA-256 ledger and Harness^2 `propose`, `probe`, `compose`, `freeze`, and `gate` transitions.
- Change Tree `summarize` and `decide` functions satisfying exhaustive finite-state properties `P1`–`P10`, including `P7` Progress.
- Bayesian hypothesis tree, R006 claim graph, and Dawid-Skene source reliability scoring.
- Branch budget accounting and `FileLeaseTable` conflict tracking.
- Two-fold Platt calibration, VOI/cost `pair_builder_and_checker` routing, and `cammut.decision/0` taint lattice enforcement.

### `arc-kit-mcp`

Shared Arc Kit JSON-RPC 2.0 MCP server for Depths 0–3 over stdio and loopback HTTP. It implements:

- Five-label memory policy, secret rejection, near-twin Jaccard supersession, and an embedded local store.
- SHA-256 write-once 1M Library index and Shelf reference search.
- `claim.record`, `gate.check`, and `prose.check` tool handlers.
- Workshop R009 30-day consent token issuance and verification.
- Native OS credential store backends across Windows Credential Manager, Linux Secret Service, and macOS Keychain.
- TOFU SSH deployment for remote Hindsight and Cammut servers.

### `arc-gateway-rs`

Cross-platform Rust loopback HTTP and SSE proxy bound to `127.0.0.1:7424`. It implements:

- Host and Origin DNS-rebinding guards.
- Anthropic four-mark prompt cache injection.
- Google Gemini and Vertex `thought_signature` and `reasoning_content` tool continuity.
- Five-attempt jittered retry for HTTP 429 and 503 responses with pre-header SSE keepalive frames.
- Cammut `/cammut/mcp` failover breaker and memory governor.

### `arc-runtime` and `arc-cli`

Standalone `arc` binary, model execution runtime, Crew scheduler, and OS sandboxing layer. It implements:

- Streaming model adapters and a Crew scheduler for `lead`, `framer`, `scout`, `builder`, `lean-prover`, `checker`, `red-team`, and `archivist` roles with a USD quota meter.
- Headless benchmark runner for BAISBench and Autonomous Science Bench.
- Zed and JetBrains ACP JSON-RPC stdio server.
- Native OS sandboxes: Windows Job Objects with restricted tokens and `CREATE_NO_WINDOW`; Linux Landlock LSM with `seccomp-bpf` and namespaces; macOS Seatbelt profiles.

### `arc-ui`

Clean-room Rust desktop shell and C2 Console. The architecture compares `wgpu` native Rust rendering against `tao`/`wry` system WebView across Windows, ARM, and Linux while preserving:

- `#faf9f6` Paper and `#171614` Dark palettes, Geist typography, and the zero blue/violet hue rule.
- The 7.4 s skippable AS cube startup intro.
- Sessions pane paired with Trace, Files, and Terminal side panes.
- Deterministic Rust Mermaid SVG layout and the Molecullage five-gate studio.
- All six Console views from PR #48: Research, Memory, Cammut, Figures, Prose, and Status.
- Out-of-process isolation for heavy external tools (Python, Chromium, Blender, ChimeraX) as MCP toolpacks gated by R009 consent.

## Roadmap alignment

Each phase of `wiki/Roadmap.md` maps directly to a Rust crate and an automated verification check.

| Roadmap phase | Scope | Rust crate | Verification check |
|---|---|---|---|
| Phase 0 | Loopback gateway, `thought_signature` replay, 7.4 s AS cube intro | `arc-gateway-rs`, `arc-ui` | `cargo test -p arc-gateway-rs` |
| Phase 1 | Lean profile, Trace tab, two-generation rollback updater | `arc-ui`, `arc-cli` | `cargo test -p arc-cli` |
| Phase 1b | PR #48 six-view C2 Console (Research, Memory, Cammut, Figures, Prose, Status) | `arc-ui`, `arc-kit-mcp` | `cargo test -p arc-ui` |
| Phase 2 | Five-label memory policy, Jaccard supersede, Cammut breaker, TOFU SSH deploy | `arc-kit-mcp`, `arc-gateway-rs` | `cargo test -p arc-kit-mcp` |
| Phase 3 | HoH ledger, Change Tree `P1`–`P10`, hypothesis tree, claim graph, Dawid-Skene, Platt VOI router | `arc-hoh-core` | `cargo test -p arc-hoh-core` |
| Phase 4 | Arc Kit Depths 0–3, Shelf, Workshop R009 consent, Molecullage, Mermaid, 4.10 Prose Gate | `arc-kit-mcp`, `arc-validators`, `arc-ui` | `cargo test -p arc-validators` |
| Phase 5 | Startup timing and headless BAISBench / Autonomous Science Bench runners | `arc-runtime`, `arc-cli` | `cargo test -p arc-runtime` |
| Phase 6 | Precompiled Win/ARM/Linux binaries, OS credential stores, zero-DSH retirement | Workspace CI, `arc-kit-mcp` | Release matrix + `SHA256SUMS.txt` |
| Phase 7 | Lean 4 `v4.34.1` kernel proofs (`ArcValidators.lean`, `ArcCheckers.lean`) and Crew safety | `arc-validators`, `arc-hoh-core`, `arc-runtime` | `lake build` + cross-check tests |

## Build slices and HoH orchestration

Delivery proceeds in seven bounded slices (`R0`–`R6`). Each slice stays within a 160 KB PR diff budget and runs through a Neon builder, an independent Hydrogen or cross-family checker, and a recorded HoH gate.

| Slice | Deliverable | Primary crates |
|---|---|---|
| `R0` | Architecture specification, clean-room contract, HoH index, and verification tests | `docs/rust-rebuild/PLAN.md`, `test/rust-rebuild-plan.test.mjs` |
| `R1` | Cargo workspace root, `arc-hoh-core` (`P1`–`P10`, ledger, VOI router), and `arc-cli` skeleton | `native/Cargo.toml`, `arc-hoh-core`, `arc-cli` |
| `R2` | `arc-kit-mcp` JSON-RPC server, 1M Library index, R009 consent, and OS credential stores | `arc-kit-mcp` |
| `R3` | `arc-gateway-rs` loopback proxy, DNS-rebinding guard, Anthropic cache, and Gemini/Vertex retry | `arc-gateway-rs` |
| `R4` | `arc-runtime` model adapters, Crew scheduler, OS sandboxes, benchmark runner, and ACP server | `arc-runtime`, `arc-cli` |
| `R5` | `arc-ui` C2 Console (six views), deterministic Mermaid layout, and Molecullage five-gate studio | `arc-ui` |
| `R6` | Multi-platform precompiled CI matrix (Win/ARM/Linux), journaled updater, and DSH kit retirement | CI matrix, release scripts |

## Limits

- Only `native/arc-validators` is compiled in Rust today; slices `R1` through `R6` are specified in this plan and have no compiled Rust crates yet.
- The `arc-ui` toolkit choice between `wgpu` native rendering and `tao`/`wry` system WebView awaits a measured startup, memory, and accessibility benchmark gate across Windows, ARM, and Linux in slice `R5`.
- External scientific tools (Python, Chromium, Blender, ChimeraX) remain out-of-process MCP toolpacks gated by R009 consent rather than Rust rewrites.
- Multi-OS release code signing (Windows Authenticode, macOS notarization) requires dedicated signing credentials and CI secrets before public distribution in slice `R6`.
