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

| Planned work | What it means | Proof |
|---|---|---|
| Pin the upstream release | Pin the upstream release tag, build it, and compare it with the shipped archive. | A hash report |
| Close the plugin manager | Part exists: the lean core switches off the plugin manager and the Plugins page. Still planned: remove pnpm from the app, the plugin market, hot reload and the registry checks, and add a read-only page called "Built-in features". | No pnpm process, no registry traffic, a page test |
| Fold in the kept plugins | Part exists: the two Arc plugins are in `plugins/`, and you install them by copying. Still planned: move the plugins we keep into the archive, including the theme skin. | A profile with an empty `node_modules` folder still works |
| Memory gateway | Build a memory gateway into the app as a host part. A setting switches it on. It has authentication, and keys go into the system credential store. Today `arc-hoh` talks to a separate local gateway on port 7424. | Recall and store work without a start-up script |
| Cammut client tab | A tab for your own Cammut server. You enter the server address, an API key and a token if the server needs one. The tab shows the connection state. You pick the memory scopes. The tab also shows the memory policy. | A fresh install with an empty profile connects to a test server, recalls a note and stores one |
| Memory policy | Part exists: `arc-hoh` puts memory rules into the prompt. Still planned: the memory policy as a built-in module, with a documented default text. See [The memory policy](The-memory-policy). | Policy tests with a fake server: each rule fires, a switched-off rule does not |
| Vendor the kept plugins | Copy the kept plugins into the repository with their license notices. | A license audit and feature checks |
| Settings-only profile | The profile keeps only its settings file. | Delete `node_modules` and every feature remains |
| Source fork | Fork the upstream source with a generated module table and reproducible hashes. | The same hash twice |
| Rust parts | Replace single parts with Rust, one at a time, only where measured time or a removed dependency justifies it. | Tests that compare output byte for byte with the current implementation |
| Public release | Credits, license files, a clean history, a first-run wizard that asks for your server address and your keys, and releases built by CI. | A clean clone builds the installer, and a scan finds no secret and no personal path |

Cammut is a separate memory server. Users run it themselves. Arc Harness talks to it through `arc-hoh` and plans a client tab. See [Connect your Cammut server](Connect-your-Cammut-server).

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
