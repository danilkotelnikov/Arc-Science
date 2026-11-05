# Plugins and why the package model goes away (a plan)

Status: Partly. The lean core already switches off the Plugins page and the plugin manager, and plugins are installed by copying. Removing the package model is a plan, and it is Planned.

## What a plugin is here

In Arc Harness almost every feature is a plugin. A plugin is a package: a folder with code and a `package.json`. The app loads a list of plugin rows from a configuration file.
Each row names a package. A module system inside the app, called Cordis, loads the package by that name.
The archive of the app holds hundreds of such packages under `arc/node_modules/@arc-harness/`. Each profile lists the bundles it loads.

## What the lean core changed

The build switches off ten browser rows by one `disabled: true` line each (patch 14 of `tools/build.mjs`). The screens gone are:

- the Plugins page, its Built-in plugin settings and the plugin inventory,
- Automation tasks,
- trajectories,
- skills,
- the account page,
- the subagent settings,
- the mode picker and the Agent presets page.

Patch 15 removes the "Show coding view" row from General settings. The host halves of these features stay, so the agent still works. A screen comes back when you delete its `disabled: true` line.
The plugin manager is off, so you install plugins by copying them and adding them to the bundle list.

## The lean profile

`node tools/lean-profile.mjs apply` cuts the bundle list of a profile to four bundles: `@arc-harness/arc-base`, `@arc-harness/arc-web-app`, `arc-theme` and `arc-hoh`.
The other packages stay installed. Only the list changes, so a bundle comes back by one line. The tool keeps an undo list, and `restore` uses it.
The file `brandtext/lean-profile.json` lists each bundle that leaves the profile and why.

## The Arc plugins

| Plugin | What it does |
|---|---|
| `plugins/arc-hoh` | Harness of Harness. The cycle, the ledger and the Trace tab. See [A review checklist](How-we-check-our-work). |
| `plugins/arc-theme` | The cream and warm dark skin, with Geist type, ink icons and short motion. See [Look and feel](Look-and-feel). |

To install one, copy the folder into `~/.arc/profiles/<profile>/node_modules`. Then add its name to `arc.profile.bundles` in the `package.json` of that profile, because a plugin loads only when that list names it. For `arc-hoh` and `arc-theme`, `node tools/lean-profile.mjs apply` does this.

## Why the package model is a problem

Four layers make up the package model.

1. **Build time.** The app is built from a monorepo of many packages.
2. **Run time.** The module system loads each plugin row by package name.
3. **On your machine.** A profile folder holds a `node_modules` folder, a lock file and a bundled copy of the pnpm tool.
   The app reaches a package registry and offers a plugin command.
4. **Bundled runtimes.** Node, pnpm and Python ship with the app.

For a person who only wants to use the app, layer 3 is the heavy one. It means that anyone can install code by name. The profile can break after an update. The app's behavior depends on what sits in a folder.
It is also hard to say exactly what a given installation does.

The build replaces the address of the Chinese npm mirror with the address of the public registry. That matters where the plugin manager is on.

## The plan

Four ways to remove the package model were compared. One was chosen.

| Option | What it is | Verdict |
|---|---|---|
| A | Keep the module system inside the app. Freeze one composition as a built-in bundle. Remove pnpm and the registry. First patch the current kit, later fork the upstream source. | Chosen |
| B | Rewrite the core in Rust and keep the React interface. | Rejected. The many client parts of the interface would need new protocols. |
| C | A Rust shell around the frozen host, plus Rust parts. | Later, one part at a time |
| D | Hide the Plugins page only. | Rejected. It does not remove the model. |

The lean core is the first step of option A. It hides the screens. It does not yet remove pnpm, the registry checks or the package folders.

## What breaks on purpose

- Install by name.
- The Plugins page.
- The plugin command of the app, once the plugin manager is closed for good.
- Creator mode and hot reload.
- The updater that works by package.

## Planned work in the roadmap

The [Roadmap](Roadmap) lists these steps:

- "Close the plugin manager" removes pnpm, the plugin market, hot reload and the registry checks.
- "Fold in the kept plugins" moves them into the archive.
- "Vendor the kept plugins" adds their notices.
- "Settings-only profile" leaves the profile with only its settings file.
- "Source fork" forks the upstream source.

## If you use plugins today

Keep copying them in. Plan for the day the plugins sit inside the archive.
