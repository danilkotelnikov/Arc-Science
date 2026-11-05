# Glossary

Status: Works today. Words are in alphabetical order.

**API key.** A secret string from a model provider. It lets the app call the provider's models and usually bills your account.

**app.asar.** The file that holds the app's code. An `asar` archive is a single file that contains many files, like a zip without compression. The kit reads it and writes a changed copy.

**app.asar.unpacked.** A folder next to `app.asar` for files that must stay outside the archive, such as native modules.

**arc.** The command name of the installed runtime. It was `dsh` in the original app. Internal names such as the runtime folder `arc/` and the packages `@arc-harness/arc-*` follow the same rename.

**ARC_HOME.** The environment variable that moves the data folder.

**AS cube.** The logo: a cube with the letters A and S on its left face.

**Build.** The step that turns the original archive into the Arc Harness archive. It is `node tools/build.mjs`.

**Cammut.** A separate memory server for agents. Users run it themselves. The plugin `arc-hoh` reads and writes it through a local gateway. See [Connect your Cammut server](Connect-your-Cammut-server).

**Cordis.** The module system inside the app. It loads each feature as a plugin row by package name.

**Data folder.** The folder where the app keeps your profiles, sessions, local plugins and keys. The default is `.arc` in your user folder. The variable `ARC_HOME` can move it.

**Electron.** The framework that runs the app as a desktop program. It brings Chromium and Node.js with it.

**Geist.** A free typeface. The product name is set in it, and the theme plugin embeds it.

**Harness of Harness.** The cycle of the plugin `arc-hoh`: propose, freeze, independent accept gate and a hash-chained ledger. See [A review checklist](How-we-check-our-work).

**Lean core.** The build setting that switches off the Plugins page, Automation tasks, trajectories, skills, account, subagent and agent preset screens. See [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).

**Ledger.** The file `hoh/ledger.jsonl` in the data folder. Each line holds the hash of the line before it, so a change shows.

**Loopback.** The address of your own machine, `127.0.0.1`. A connection to it does not leave your computer.

**MCP.** Model Context Protocol. A standard way for a model to call tools on another program, called an MCP server.

**Memory policy.** The rules for when an agent reads from and writes to a memory server. See [The memory policy](The-memory-policy).

**Model.** The AI system that answers. A provider runs it.

**Original archive.** The `app.asar` of the unchanged original app, version 0.2.1-rc.5. The kit calls it "pristine".

**Package model.** The way the app loads features: as packages, found by name, kept in a profile folder. See [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).

**Patch.** One change that the build makes to the archive. Each patch counts the places it changed.

**Permission mode.** The setting that decides what the agent may do without asking you. "Workspace Write" is the default.

**Plugin.** A feature of the app in the form of a package. The kit has two of its own: `arc-hoh` and `arc-theme`.

**pnpm.** A tool that installs packages. The original app carries a copy of it.

**Profile.** A set of plugin rows and settings. The app has a web profile and a desktop profile. Each lives in `profiles/<name>/` in the data folder.

**Provider.** A company or service that runs models and offers them through an API.

**Review checklist.** The short list of steps for a change: plan, build with tests, freeze, independent review, evidence before acceptance. See [A review checklist](How-we-check-our-work).

**Session.** One conversation between you and the agent, with its files and steps.

**SHA-256.** A fingerprint of a file. Two files with the same SHA-256 are the same file.

**Skill.** A packaged set of instructions that the agent can load for a kind of task. The lean core has no skills screens.

**Subagent.** A second agent that the main agent starts for part of a task. The Harness of Harness cycle uses a fresh subagent as the reviewer.

**Telemetry.** Data that a program sends to its maker about how you use it. The build switches the original app's telemetry off.

**Trace tab.** A tab in the right sidebar, from the plugin `arc-hoh`. It shows the ledger, newest first, with the chain check, and the memory brief.

**Workspace.** The folder the agent works in.
