# HoH rebuild index

This index tracks the clean-room Rust rebuild specification, active loop slices, and verification commands for Arc Harness.

## Specification links

- Master architecture plan: `docs/rust-rebuild/PLAN.md`
- Reader overview: `wiki/Clean-room-Rust-rebuild.md`
- Roadmap reference: `wiki/Roadmap.md`
- Plan validation suite: `test/rust-rebuild-plan.test.mjs`

## Loop slices

| Slice | Scope | Primary artifacts |
|---|---|---|
| `R0` | Clean-room Rust rebuild specification and plan test suite | `docs/rust-rebuild/PLAN.md`, `docs/hoh/index.md`, `wiki/Clean-room-Rust-rebuild.md`, `test/rust-rebuild-plan.test.mjs` |
| `R1` | Cargo workspace root, `arc-hoh-core`, and `arc-cli` | `native/Cargo.toml`, `native/arc-hoh-core/`, `native/arc-cli/` |
| `R2` | `arc-kit-mcp` server and OS credential stores | `native/arc-kit-mcp/` |
| `R3` | `arc-gateway-rs` loopback proxy | `native/arc-gateway-rs/` |
| `R4` | `arc-runtime`, OS sandboxes, Crew scheduler, and ACP | `native/arc-runtime/` |
| `R5` | `arc-ui` C2 Console, Mermaid SVG, and Molecullage studio | `native/arc-ui/` |
| `R6` | Multi-platform precompiled CI matrix and DSH retirement | Release matrix and updater |

## Verification commands

- `node --test test/rust-rebuild-plan.test.mjs`
- `node tools/prose-gate.mjs check docs/rust-rebuild/PLAN.md docs/hoh/index.md wiki/Clean-room-Rust-rebuild.md`
- `node scripts/check-syntax.mjs`
- `node scripts/version-sync.mjs --check`
- `node scripts/privacy-scan.mjs`

## Limits

- Slice `R0` covers architecture documentation and automated plan checks only; slices `R1` through `R6` are not yet implemented or frozen.
- Independent Hydrogen verification and `hoh_gate` acceptance for `R0` run after the builder hands back the workspace.
