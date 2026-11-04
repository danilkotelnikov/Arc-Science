# FAQ

Status: Works today. The answers describe the project as it is now.

## Is this an official product of the original vendor?

No. Arc Harness is an independent, unofficial project. The original vendor does not endorse it and is not affiliated with it.

## Why does the repository not contain the app?

The app belongs to its authors. The kit only changes a copy that you already have on your machine. This keeps the original out of the repository and keeps the history small.
It also means you get the original from its official installer.

## Do I need an account with the original vendor?

No. The sign-in window is skipped. You need an API key from a model provider. See [Add your API keys](Add-your-API-keys).

## Which models can I use?

Any model that one of the catalog providers serves, or that a custom provider serves. See [Models and providers](Models-and-providers).

## Does it work on macOS or Linux?

Only Windows is tested. The build is plain Node.js. The install tool and the live tests are written for Windows.
We have not tried other systems.

## Does it work with a newer version of the original app?

No. The patches target version 0.2.1-rc.5. A different version needs new patches. The build stops with "patch failed" when the archive does not match.

## Can I run a memory server?

Not through a built-in feature yet. The plugin `arc-hoh` can read notes from your own Cammut server and write gate verdicts to it through a local gateway.
See [Connect your Cammut server](Connect-your-Cammut-server) and [The memory policy](The-memory-policy). The client tab and the default policy file are Planned.

## Where is my data?

In your data folder. The default is the folder `.arc` in your user folder. It holds profiles, sessions, local plugins and the key file. Set `ARC_HOME` to move it.
The first install copies the old `.dsh` folder there. `.dsh` stays as it was.

## Does the app send my data to anyone?

It sends your prompts and files to the model provider you configured, because that is how the model answers. The build removes the original vendor's telemetry, sign-in and update checks.
[Privacy and security](Privacy-and-security) explains what was checked and what was not.

## Can the agent read my keys?

Yes. The key file is private to your user, but the agent runs commands as you. See [Privacy and security](Privacy-and-security).

## How do I update Arc Harness?

Pull the latest kit, build again from the original archive, and run `install`. The app does not update itself. The update coordinator is off.

## How do I remove it?

Run `node tools/install.mjs rollback` to restore the original app. Use the original uninstaller to remove the app itself. Delete your data folders if you want to remove your data.
Not tested: no check ran the original uninstaller.

## Why is the old name still in some places?

The installed app keeps the original program file name, install folder and Start menu name. The design-token prefixes `dsw-` and `ds-` stay, and so do the ids of real models in the third-party catalog.
The internal names are Arc names: the packages, the runtime folder, the command `arc`, the data folder `.arc` and the variable `ARC_HOME`. See "What stays" in [Build from source](Build-from-source).

## Why are the Chinese texts gone?

The build replaces them with their English twins. It removed Chinese documents too. A Chinese interface is not a goal of this project today.

## Why does the app have no Plugins page?

The lean core switches it off, with Automation tasks, trajectories, skills, account, subagent and agent preset screens. You install plugins by copying them.
See [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).

## Can I use my own logo?

The logo files are in `brand/dist`. The script `brand/build_brand.py` writes them from brand source files that live outside the repository.
The first lines of the script name the folders and files it expects. Put your own cube files there, set `ARC_BRAND_SRC`, run the script and rebuild. Keep the license notices.
The AS cube itself is not covered by the MIT license. See [Credits and licenses](Credits-and-licenses).

## How do I contribute?

Read [Contributing](Contributing).
