# Arc Harness

Arc Harness is a desktop app where an AI model works in sessions. It reads and edits files in a workspace, runs shell commands within the permission mode you choose, and calls tools. Its goal is a scientific harness that never grades its own work.

It is a rebuilt copy of the MIT-licensed DeepSeek Harness 0.2.1-rc.5, with its own look, the AS cube logo, a lean set of screens, and no connections to the original vendor's services. This repository holds the build kit and the Arc plugins. It does not contain the original app: you bring your own copy.

This repository was the home of the Arc Science desktop app. That app and its research backend remain in the git history (branch `feat/blockprint-hoh` and earlier tags).

## What the build changes

| Change | How |
|---|---|
| AS cube logo, product name, ink icons, no blue or violet | `tools/build.mjs`, patches 1 to 10 |
| No update feed, no telemetry, no DeepSeek service connections | patches 9 and 11 |
| Light first run, the cream look in Light and a warm dark set in Dark | patch 7 and the theme plugin |
| "Thinking" and "Thinking for 2s" as the running label | patch 13 |
| Lean core: no Plugins page, Automation tasks, trajectories, skills, account, subagent and agent preset screens | patch 14 (one `disabled: true` line per screen) |
| No "Show coding view" row in General settings | patch 15 |
| Lean profile: 4 bundles (`dsh-base`, `dsh-web-app`, `dsh-theme-pair`, `dsh-hoh`) | `tools/lean-profile.mjs`, with an undo list |

## The Arc plugins

| Plugin | What it does |
|---|---|
| `plugins/dsh-hoh` | Harness of Harness. Every task goes through propose, freeze and an independent accept gate. Each step is written to a hash-chained ledger. The Trace tab in the right sidebar shows the ledger, newest first, with the chain check, and the memory brief the agent reads. |
| `plugins/dsh-theme-pair` | The cream and warm dark skin, with Geist type. |

The memory brief and the gate verdicts use a Cammut memory server through a local gateway at `127.0.0.1:7424`. Without one, the plugin keeps working and the brief stays empty.

## Build and install (Windows)

You need Node.js 22.19 or newer and an installed DeepSeek Harness 0.2.1-rc.5.

1. Copy `app.asar`, `app-update.yml`, `icon.png` and `tray.ico` from `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources` into `pristine\`.
2. Check them against `pristine/SHA256SUMS.txt`.
3. Run `node tools/build.mjs`. The build stops if a patch does not find its text.
4. Run `node test/build-check.mjs build/app.asar <scratch folder>`.
5. Close the app. Run `install.cmd`. To undo, run `install.cmd rollback`.
6. Optional: run `node tools/lean-profile.mjs apply` for the lean profile, and `restore` to undo.

Install the plugins into your profiles with the app's own plugin command, or copy them into `~/.dsh/profiles/<profile>/node_modules`.

Set `ARC_RESOURCES` or `ARC_APP_DIR` when the app is installed somewhere else.

## Checks

| Check | Command |
|---|---|
| Build check (hashes, every patch, brand files) | `node test/build-check.mjs build/app.asar <scratch>` |
| Every screen in first run, dark and light, in a throwaway data home | `node test/ui-crawl.mjs --lean [--plugin plugins/dsh-hoh]` |
| No DeepSeek, DSH or Whale wording | `node test/ui-strings.mjs`, `node test/independent-scan.mjs` |
| No connection to DeepSeek services | `node test/no-deepseek-net.mjs --live` |
| The scans really find things (on the original archive) | `node test/positive-control.mjs` |
| Plugin tests | `node --test plugins/dsh-hoh/test/hoh.test.mjs`, `node --test plugins/dsh-theme-pair/test/theme.test.mjs` |
| Privacy scan before a push | `node scripts/privacy-scan.mjs` |

## Known limits

- The installed app still uses the original program file name, install folder, Start menu name and the folders `.dsh` and `deepseek-harness`. Renaming is planned.
- The plugin manager is switched off in the lean core, so plugins are installed by copying.
- Only Windows is tested.

## Licence

The code is MIT (`LICENSE`). The AS cube logo is an exception: see `NOTICE.md`. DeepSeek Harness is MIT, copyright 2026 DeepSeek (`THIRD_PARTY_LICENSES/`). Arc Harness is an independent project and is not affiliated with DeepSeek.
