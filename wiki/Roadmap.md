# Roadmap

Status: Partly. Phases 0, 1, 1b, 2, 3, and 4 run in version 0.5.0; Phase 5 benchmark runners and Phase 6 native and installer modules are built, while the public benchmark run and upstream source fork remain planned.

## Order

The app works first, then claims, then proof. Nothing new goes in unless the app opens, Settings works and a real model replies. `test/desktop-journey.mjs` checks that.

| Phase | What | State | Proof |
|---|---|---|---|
| 0. Working basics | The gateway restarts itself and passes long requests. Google Vertex replies with `thought_signature` replay. Choreographed 7.4 s startup intro with `Skip intro`. Running labels shine from one gradient. | Built | `build-check.mjs` and `desktop-journey.mjs` |
| 1. Lean Arc Harness | Coding view row removed, Trace tab, crawl in three phases, install with undo. | Built | Crawl and gate reports |
| 1b. App look | Built-in plugins leave Settings. One unified C2 console joins Research, Memory, Molecullage and Prose with Servers, Keys, Apps and Audit. | Built (`arc-core` 0.2.0) | `plugins/arc-core/test/ui-panel.test.mjs` |
| 2. Memory upgrade | Five-label note policy, secret rejection, near-twin supersede, fail-open Cammut breaker, and TOFU SSH server deploy. | Built (`arc-core` 0.2.0) | `plugins/arc-core/test/core.test.mjs` |
| 3. Claims and rating | Held-out patch replay gate, Bayesian hypothesis tree, claim graph, Dawid-Skene source reliability, branch budgets, decision checkpoints, and Brier-calibrated Intuition Router. | Built (`arc-hoh` 0.4.0) | `plugins/arc-hoh/test/*.test.mjs` |
| 4. Research session, Arc Kit, Shelf and Workshop | Shared `arc-core` MCP and skills, built-in read routes, three panes, decision map, 30-day consent dialog, Shelf reference library, Workshop toolpacks, `arc-molecullage` studio, and `arc-mermaid` chat diagram renderer. | Built (`0.5.0`) | `npm test` across all six plugins |
| 5. Benchmark proof | Startup speed baseline (`tools/measure-start.mjs`) and headless benchmark runner (`tools/bench-runner.mjs`) built; public benchmark campaign open. | Runners built; public run planned | Score against published agents, same budget |
| 6. Native and public | Windows installer (`tools/package.mjs`, `installer/arc-harness.iss`), vendored bundle license audit, loopback `127.0.0.1` Cammut gateway, settings-only profile pruner, and Rust `native/arc-validators` built; upstream source fork open. | Core slices N0–N9 built; source fork planned | `native-transition.test.mjs` and `cargo test` |

## Arc Kit, Shelf and Workshop

Arc Harness shares its core across hosts through **Arc Kit**: rule files at Depth 0, Agent Skills and the `arc-core` MCP server at Depth 1, hooks and a plugin bundle at Depth 2, and the headless `arc` command and ACP agent at Depth 3. Even when a host has no hook system, `arc-core` enforces two rules in code: only a checker other than the builder can record an accepted verdict, and every side-effecting tool call requires a consent token issued by the window or terminal.

Agent work uses four typed layers. The **Thought** layer summarises one step and drops the raw trace. The **Intuition** layer runs a small fast model to return probabilities for routing, risk and effort, checked by Brier score. The **Decision** layer writes a YAML record of options, choice, evidence, reversibility and check. The **Claim** layer records a statement with its evidence level and traced numbers in the claim graph.

The **Shelf** is a local, version-pinned reference corpus searched before a task. The **Workshop** loads software and MCP toolpacks on a task signal (Structure, CAD, 3D, 2D, App, Science compute, and the scope-gated `Inspect` reverse-engineering pack). The Molecullage 231-source library, eight-domain software and model atlas, and 56-rule anti-overplating grammar (`overplate = 0`) form the first verified Shelf and toolpack vertical for the Molecullage workspace (`arc-molecullage`).

The **Memory server deploy tab** deploys Hindsight, the Cammut gateway and a reverse proxy to a user's Linux server over SSH. A native main-process password dialog holds the one-time password in memory for the first login so that no password enters the WebView, URLs, storage or logs.

## The goal

Arc Harness should stop being a package-based system. It should start with one fixed set of features and keep the upstream code compatible.
It should also have a place for a memory server and for its client. Rust is used only where it saves measured time or removes a dependency.

The chosen path is option A on the page [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).
Keep the module system inside the app. Freeze one composition. Remove pnpm and the registry. First patch the current kit, then fork the upstream source.

## Phase 6 in detail

Each item is small and has a proof. Each goes through the review checklist on the page [A review checklist](How-we-check-our-work).

| Work item | State in 0.5.0 | Proof |
|---|---|---|
| Pin the upstream release | Built in `lib/native/upstream-diff.mjs` and `brandtext/upstream-manifest.json`; building upstream from source remains planned. | Manifest hash report in `native-transition.test.mjs` |
| Close the plugin manager | Lean core switches off the Plugins page, and `lib/native/runtime-guard.mjs` blocks `pnpm` and registry probes in tests. Removing `pnpm` from the upstream archive awaits the source fork. | `ui-crawl.mjs --lean` and `native-transition.test.mjs` |
| Fold in the kept plugins | All six Arc plugins live in `plugins/`, and `lib/native/vendor-bundler.mjs` stages them with a license audit. Folding them into a single unpatched archive awaits the source fork. | `native-transition.test.mjs` |
| Memory gateway | `lib/native/cammut-gateway.mjs` implements the loopback `127.0.0.1` Bearer-authenticated Cammut gateway, and `plugins/arc-core/lib/deploy.js` deploys Hindsight and Cammut over TOFU SSH. System credential-store storage remains planned. | `native-transition.test.mjs` and `plugins/arc-core/test/core.test.mjs` |
| Cammut client tab | `plugins/arc-core` provides the C2 console (Memory and Servers panels) plus TOFU SSH server deployment; system credential-store storage remains planned. | `plugins/arc-core/test/ui-panel.test.mjs` |
| Memory policy | Built in `plugins/arc-core` (five-label note policy, secret rejection, near-twin supersede, and fail-open Cammut breaker) alongside the `arc-hoh` prompt contract. | `plugins/arc-core/test/core.test.mjs` |
| Vendor the kept plugins | Built in `brandtext/upstream-manifest.json` and `lib/native/vendor-bundler.mjs`, generating `THIRD_PARTY_NOTICES`. | `native-transition.test.mjs` |
| Settings-only profile | `lib/native/settings-profile.mjs` implements the settings-only profile pruner; removing `node_modules` at boot awaits the source fork. | `native-transition.test.mjs` |
| Source fork | `lib/native/module-table.mjs` generates deterministic Cordis module tables; the full upstream source fork remains planned. | Same hash twice (`native-transition.test.mjs`) |
| Rust parts | Built in `native/arc-validators` (zero-dependency Rust crate for SHA-256, prose rules, secret scans, hook guards, SVG bounds, network grants and seal guards). | `cargo test --manifest-path native/arc-validators/Cargo.toml` |
| Public release | Windows installer staging (`tools/package.mjs`, `installer/arc-harness.iss`), releases `0.1.0` to `0.5.0`, and SHA-pinned Node + Rust CI are built; upstream source fork and first-run wizard remain planned. | `test/package.test.mjs` and `npm run scan` |

Cammut is a separate memory server that users run themselves. Arc Harness connects through `arc-hoh`, the `arc-core` MCP tools and C2 console, and the loopback gateway module in `lib/native/cammut-gateway.mjs`. See [Connect your Cammut server](Connect-your-Cammut-server).

## Order

The first three items come first, because they remove the packages. The memory gateway, the client tab, the memory policy and vendoring the plugins follow.
The settings-only profile and the source fork finish the package story. Rust parts come after that, where their files do not overlap.
The public release comes last, because it needs the source fork, the client tab and a decided license for the merged work.

## What a public release needs

- Credit to the original, with the upstream license text and copyright line. This repository already has it. See [Credits and licenses](Credits-and-licenses).
- No binary of the upstream app in the repository. Today the kit rebuilds from your own copy of the original archive. A release would build from source or fetch the upstream release at build time.
- No personal data. The repository holds a scan for it, and CI runs it with generic patterns. Run it yourself with `npm run scan`.
- A first run for any user. A wizard asks for the address of your memory server and your API keys.
- A default memory policy, shipped as a documented file.

## Built in 0.5.0

- The archive build kit (`tools/build.mjs`) with patches 1 to 17, including Google `thought_signature` tool continuity and the 7.4-second choreographed AS cube intro. See [Build from source](Build-from-source).
- The clean-room rename: packages `@arc-harness/arc-*`, the runtime folder `arc/`, the command `arc`, the data folder `~/.arc` and the variable `ARC_HOME`.
- Six built-in Arc plugins: `arc-hoh` (`0.4.0`), `arc-core` (`0.2.0`), `arc-theme` (`0.6.0`), `arc-mode` (`0.2.0`), `arc-molecullage` (`0.1.0`), and `arc-mermaid` (`0.2.0`).
- Windows installer staging (`tools/package.mjs`, `installer/arc-harness.iss`), benchmark runners (`tools/measure-start.mjs`, `tools/bench-runner.mjs`), Phase 6 native transition modules (`lib/native/`), and zero-dependency Rust validators (`native/arc-validators`).
- This repository, with the wiki, privacy scan, changelog, citation file and SHA-pinned Node + Rust CI in `.github/workflows/ci.yml`.

## What is not decided

The license of the merged work in a final release. The interface is English only today.
