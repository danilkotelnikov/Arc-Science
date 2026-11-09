# What is Arc Harness

Status: Partly. The build kit and its checks are in this repository. The desktop journey test opens the window and clicks through Settings; no check runs the installer. The parts that are not built yet are marked Planned on their own pages.

## In one paragraph

Arc Harness is a desktop app for working with an AI model. You open a session, pick a workspace folder, and describe a task.
The model reads and edits files in the workspace, runs shell commands and calls tools. You decide how far it may go by choosing a permission mode.
Its goal is a scientific harness that never grades its own work.

## Where it comes from

Arc Harness is an MIT-licensed desktop agent app with changes. The changes are made by scripts in this repository.
The scripts read the original app archive, change a copy, and write a new archive. The original app is not in this repository. You bring your own copy.

Read [Credits and licenses](Credits-and-licenses) for the credit.

## What the changes are

| Change | What you see |
|---|---|
| New name and logo | The AS cube and the name "Arc Harness" replace the whale and the old wordmark. |
| Ink icons | Icons that were blue or purple are ink or warm gray. |
| Light first run | A new data folder starts in the Light appearance. Dark and System stay available. |
| Cream look | The theme plugin gives Light a cream paper look and Dark a warm set. |
| No vendor services | Sign-in, telemetry, the update feed and the vendor's web addresses are removed or cannot resolve. |
| English only | The Chinese texts of the app are replaced by their English twins where a twin exists. A few Chinese words can remain in code comments or in keys that have no twin. |
| Lean core | The Plugins page, Automation tasks, trajectories, skills, account, subagent and agent preset screens are switched off. |
| Arc names inside | The data folder is `~/.arc`, its variable is `ARC_HOME`, the runtime folder is `arc/` and the command is `arc`. |
| Six Arc plugins | `arc-hoh` runs Harness of Harness and Trace; `arc-core` runs Arc Kit MCP and the C2 console; `arc-theme` sets the paper, dark, Black and white, and Radium themes plus the startup intro; `arc-mode` adds the Advanced page; `arc-molecullage` adds the figure studio; `arc-mermaid` draws chat diagrams. |
| Native validators and installer | `native/arc-validators` checks hashes, prose rules, secret scans, and seals in Rust, and `tools/package.mjs` stages the Windows installer. |

The wiki page [Build from source](Build-from-source) lists every patch.

## What it is not

- It is not an official product of the original vendor.
- It does not include a model. You bring your own API keys for a model provider.
- It does not include a memory server. The plugin `arc-hoh` can talk to your own Cammut server through a local gateway. [Connect your Cammut server](Connect-your-Cammut-server) has the details.

## Who it is for

Arc Harness suits you if you bring your own keys and want an agent app without a vendor account.
You need to be comfortable with a terminal, because you build the app yourself.

## Where it is going

[Roadmap](Roadmap) lists the next steps: the public benchmark campaign, operating-system credential storage and the upstream source fork.
