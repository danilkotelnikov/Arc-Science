# Clean-room Rust rebuild

Arc Harness is moving to a clean-room full-Rust architecture licensed under MIT. The rebuild removes every dependency on DeepSeek Harness (DSH), including `pristine/app.asar`, JavaScript or binary patching, Electron, bundled Node.js, `pnpm`, Cordis, and the Go `arc-gateway`.

## Precompiled native binaries

Release builds publish full Rust source code in this repository alongside precompiled native binaries for Windows, ARM, and Linux:

- `x86_64-pc-windows-msvc` (Windows x64)
- `aarch64-pc-windows-msvc` (Windows ARM64)
- `x86_64-unknown-linux-musl` and `x86_64-unknown-linux-gnu` (Linux x64)
- `aarch64-unknown-linux-musl` and `aarch64-unknown-linux-gnu` (Linux ARM64)
- `aarch64-apple-darwin` (macOS Apple Silicon ARM64)

Every binary uses pure-Rust TLS (`rustls`), reproducible `--locked` builds, `SHA256SUMS.txt` and `RELEASE-MANIFEST.json` verification digests, and a two-generation journaled rollback updater.

## Crate map

| Crate | Responsibility |
|---|---|
| `arc-validators` | Zero-dependency SHA-256, prose gate, ASD-STE100, privacy/hue/brand scan, hook guard, SVG bounds, seal guard, and network grants paired with `lean/ArcValidators.lean`. |
| `arc-hoh-core` | Hash-chained SHA-256 ledger, Harness^2 lifecycle, Change Tree `P1`–`P10` (`P7` Progress), hypothesis tree, R006 claim graph, Dawid-Skene scoring, `FileLeaseTable`, and Platt VOI/cost router paired with `lean/ArcCheckers.lean`. |
| `arc-kit-mcp` | Shared Arc Kit JSON-RPC 2.0 MCP server (Depths 0–3), five-label memory policy, 1M Library index, Shelf search, R009 30-day consent tokens, OS credential stores, and TOFU SSH deploy. |
| `arc-gateway-rs` | Loopback `127.0.0.1:7424` HTTP/SSE proxy with DNS-rebinding guards, Anthropic four-mark cache injection, Gemini/Vertex `thought_signature` continuity, jittered 429/503 retries, and Cammut failover. |
| `arc-runtime` / `arc-cli` | Standalone `arc` binary, streaming model adapters, Crew scheduler with USD quota meter, headless benchmark runner, ACP stdio server, and OS sandboxes (Windows Job Objects, Linux Landlock/seccomp, macOS Seatbelt). |
| `arc-ui` | Native Rust desktop shell and six-view C2 Console (Research, Memory, Cammut, Figures, Prose, Status), `#faf9f6` Paper and `#171614` Dark themes, Geist typography, 7.4 s AS cube intro, deterministic Mermaid SVG, and Molecullage five-gate studio. |

Full technical details live in `docs/rust-rebuild/PLAN.md` and `docs/hoh/index.md`.

## Limits

- Today only `native/arc-validators` is compiled in Rust; slices `R1` through `R6` are specified in `docs/rust-rebuild/PLAN.md` and are not yet built.
- Heavy external tools (Python, Chromium, Blender, ChimeraX) stay out-of-process as MCP toolpacks under R009 consent.
