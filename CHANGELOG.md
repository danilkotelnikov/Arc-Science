# Changelog

All notable changes to Arc Harness are listed here. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). The kit is at version `0.5.0`, and each built-in plugin carries its own `package.json` version.

## [0.5.0] - 2026-11-10

### Added

- `plugins/arc-mermaid` `0.2.0`: deterministic Mermaid diagram engine for `flowchart`, `stateDiagram`, and `sequenceDiagram` blocks in chat, with layered layout, Diagram/Source toggle, SVG and PNG export, and Molecullage layout and colour-vision gate checks (64 tests).
- Google Gemini and Vertex AI `thought_signature` continuity (`tools/build.mjs` patch `15b`): captures `extra_content.google.thought_signature` on streamed tool calls and replays it in `convertMessages`, with a `"skip_thought_signature_validator"` fallback on unsigned historical turns.
- Choreographed startup intro and immediate window reveal (`tools/build.mjs` patch `15c` and `plugins/arc-theme` `0.6.0`): shows `mainWindow` as soon as the boot page loads and runs a 5-stage, 7.4-second AS cube wireframe-to-solid turn and character clip-mask animation with `Skip intro` (`Esc`, `Space`, or `Enter`) and `window.arcPlayIntro()` replay.
- `brandtext/lean-profile.json` and `tools/lean-profile.mjs`: automatically activate installed optional Arc plugins (`arc-core`, `arc-mode`, `arc-molecullage`, `arc-mermaid`) alongside `arc-theme` and `arc-hoh`.
- `brandtext/upstream-manifest.json`: registers all six built-in Arc plugins (`arc-core`, `arc-hoh`, `arc-mermaid`, `arc-mode`, `arc-molecullage`, `arc-theme`) in the Phase 6 vendored bundler and `THIRD_PARTY_NOTICES` generator.

### Changed

- `plugins/arc-theme` `0.6.0`: sets `will-change: transform` on menu motion rules and adds `24px` backdrop blur (`--dsw-menu-backdrop-filter`) with opaque surface fills so menus blur the page behind them; adds runtime `COPY` Settings label normalization.
- `plugins/arc-mode` `0.2.0`: refines Settings copy for open and private benchmark sections (`Open benchmark results`, `Missing`, `Loading…`).
- `plugins/arc-hoh` bumped to `0.4.0`, `plugins/arc-core` bumped to `0.2.0`, and `native/arc-validators` bumped to `0.5.0`.
- `.github/workflows/ci.yml`: runs the complete `npm test` suite across all six plugins, build kit, benchmark self-tests, and native transition tests, followed by `cargo test` on `native/arc-validators` and `privacy-scan.mjs`.
- `README.md` and `wiki/` pages rewritten to document all six plugins, the C2 console, Rust validators, installer tools, and release `0.5.0`; desktop screenshots framed with dual-contrast mats so every image passes `ghfit.py` across GitHub Light, Dark, and Dimmed themes.

### Removed

- Purged November 4 debug-progress narrative and failed-run screenshots (`task-run.png`, `task-memory.png`, `task-approval.png`), retired Built-in plugins screenshot (`light-settings-plugins.png`), and stale white-background November 4 raster schematics (`roadmap.png`, `arc-build.png`, `request-flow.png`, `hoh-cycle.png`).
- Pruned 5 merged temporary worktrees, 8 merged local feature branches, and all 14 stale remote feature branches on `origin` so `origin/main` is the sole remote branch.

## [0.4.0] - 2026-11-09

### Added

- Unified C2 console UI (`plugins/arc-core/ui/panel.js` and `lib/console.js`): joins Research, Memory, Molecullage, and Prose workspaces with Servers, Keys, Apps, and Audit panels, three-pane Research session view, 30-day consent dialog, and local prose rule detector.
- Phase 6 Arc Native and Rust transition slices `N0` to `N9` (`lib/native/` and `native/arc-validators`): pinned upstream manifest diffing, runtime package-manager guards, vendored plugin license audit, loopback `127.0.0.1` Cammut gateway, settings-only profile pruner, and Cordis module-table generator. Includes the zero-dependency Rust crate (`sha256`, `arc_rules`, `arc_scan`, `arc_hook`, `vector_assets`, `seal_guard`, `grants_net`).
- Intuition Router and decision checkpoints (`plugins/arc-hoh/lib/intuition.js`): `DEC-xxxx` schema validation, 13-state task graph checkpoint/resume, and Brier-calibrated routing.
- `tools/bench-runner.mjs`: deterministic headless benchmark harness with self-test suite.

## [0.3.0] - 2026-11-08

### Added

- `plugins/arc-core` `0.1.0`: shared Arc Kit MCP server (`shelf.search`, `claim.record`, `gate.check`, `toolpack.load`, `memory.retain`, `memory.recall`), five-label memory policy, Shelf reference search, Workshop signal router, and TOFU SSH memory deployment (`lib/deploy.js`).
- `plugins/arc-molecullage` `0.1.0`: Molecullage workspace backed by the 231-source library, eight-domain software atlas, and five-gate anti-overplating check.
- `plugins/arc-mode` `0.1.0`: Advanced settings page with the Arc Harness mode switch, installed hooks and skills inventory, and measured benchmark tables.
- `tools/package.mjs` and `installer/arc-harness.iss`: Windows installer staging (`Arc Harness.exe`) and Inno Setup definition.
- `tools/measure-start.mjs`: startup latency and memory baseline runner.

### Changed

- `plugins/arc-theme` `0.5.0`: provides three themes (`Arc Harness`, `Black and white`, `Radium`) with Geist typography and a Theme selector in General settings.
- Unified all plugin titles to Sentence case with space delimiters.
- `plugins/arc-hoh`: `hoh_gate` accepts frozen candidate hashes with or without a leading `sha256:` prefix.

### Removed

- Switched off the Built-in plugins settings screen in `tools/build.mjs` patch 14; built-in plugins stay active in the host.
- Retired separate Molecules and BioArt workspace plans in favor of `arc-molecullage`.

## [0.2.0] - 2026-11-06

### Added

- Phase 3 verification modules in `plugins/arc-hoh`: held-out patch replay gate (`lib/replay.js`), Bayesian hypothesis tree (`lib/tree.js`), claim graph (`lib/claims.js`), Dawid-Skene source reliability (`lib/reliability.js`), and branch budget allocator (`lib/budget.js`).
- Pull request review workflows (`.github/workflows/claude.yml` and `pr-screen.yml`) with fork refusal, trusted-comment filtering, and bounded fix rounds.

## [0.1.0] - 2026-11-05

### Added

- Clean-room internal rename (`@arc-harness/arc-*`, `arc/`, `~/.arc`, `ARC_HOME`), reversible data-home migration, workflow clips in `media/`, `test/desktop-journey.mjs`, `test/header.test.mjs`, wiki pages, `CITATION.cff`, and SHA-pinned GitHub Actions CI.
