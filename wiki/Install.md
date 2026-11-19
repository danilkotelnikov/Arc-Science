# Install

Status: Partly. The kit builds and installs on Windows, and `test/desktop-journey.mjs` checks the desktop window and Settings. Native menus and the Inno Setup installer are not run in CI. macOS and Linux are not tested.

This page takes you from nothing to a patched app. It has no model keys in it yet. [Add your API keys](Add-your-API-keys) comes next.

## What you need

- Windows 10 or 11, 64-bit.
- Node.js 22.19 or newer. Check with `node --version`.
- Git.
- The original app, version 0.2.1-rc.5, installed from its official installer. The kit patches exactly this version.
- Free disk space for the copy of the original archive and for the build.

## Steps

1. Install the original app, version 0.2.1-rc.5. Close it if it runs.
2. Clone this repository. Open a terminal in the folder.
3. Copy `app.asar`, `app-update.yml`, `icon.png` and `tray.ico` from the `resources` folder of the original app into the folder `pristine\`.
4. Compare each file with `pristine/SHA256SUMS.txt`. The install command checks the same list later.
5. Run `node tools/build.mjs`.

   The build reads `pristine/app.asar`. It also reads the original `app.asar.unpacked` folder, which holds the original `dsh` folder. It looks in `pristine/` first and then in the `resources` folder of the installed app.
   It writes `build/app.asar`, `build/BUILD.json` and `build/app.asar.unpacked`.
6. Optional: run `node test/build-check.mjs build/app.asar <scratch folder>`. [Run the tests](Run-the-tests) explains it.
7. Close the app. Windows locks the archive while the app runs.
8. Run `node tools/install.mjs install`, or run `install.cmd`. It calls the same tool.

   The tool swaps in the new archive and the new icons and deletes the update feed file `app-update.yml`.
   It moves the original side folder `app.asar.unpacked` to `pristine/` and puts an Arc copy in its place. It renames the command and skill files of the installed runtime, so `dsh.cmd` becomes `arc.cmd`. It keeps the originals in `pristine/runtime`.
   It copies your old data folder `~/.dsh` to `~/.arc`. The section "The data folder" below explains this.
9. Start the app from its shortcut, or run `node tools/package.mjs [--rcedit <rcedit-x64.exe>] [--iscc <ISCC.exe>]` to stage `Arc Harness.exe` and build `build/Arc-Harness-Setup-0.5.0.exe` from `installer/arc-harness.iss`.
10. Copy the Arc plugins (`plugins/arc-hoh`, `plugins/arc-theme`, `plugins/arc-core`, `plugins/arc-mode`, `plugins/arc-molecullage`, `plugins/arc-mermaid`) into `~/.arc/profiles/web/node_modules` and `~/.arc/profiles/desktop/node_modules`.
11. Close the app and run `node tools/lean-profile.mjs apply`. It activates `@arc-harness/arc-base`, `@arc-harness/arc-web-app`, `arc-theme`, `arc-hoh`, and every optional Arc plugin installed in `node_modules`. Run `node tools/lean-profile.mjs restore` to undo it.

## The data folder

The app keeps its data in `~/.arc`. Set `ARC_HOME` to move it.
The first install copies the old `~/.dsh` there. Settings, profiles, plugins and skills get Arc names. Conversations, logs and keys are copied byte for byte.
`~/.dsh` stays as it was, so `install.cmd rollback` gets the original app back with its data.
The copy runs only when `~/.dsh` exists and `~/.arc` has no `profiles` folder yet.

## Where the app folder is

The tools look for the app in the `resources` folder of the original app. That is where the official installer puts it.
If yours is elsewhere, set the environment variable `ARC_RESOURCES`. The live tests read `ARC_APP_DIR` for the folder that holds the program. [Run the tests](Run-the-tests) has the details.

## Update plugins and programs

An installed Arc Harness can fetch newer plugins and native programs from [GitHub Releases](https://github.com/danilkotelnikov/Arc-Science/releases). Open the console and choose **Updates**. The panel shows the installed and the latest version, the release notes, and these controls:

- **Update mode.** *Off* never looks for updates. *Notify* (the default) looks every 12 hours and tells you in the console. *Auto* also installs a newer version. A manual **Check now** and **Update now** work in every mode.
- **Update now.** It downloads the kit zip and `SHA256SUMS.txt` of the same release and checks the zip against the checksum file. It then checks every plugin and program file against `RELEASE-MANIFEST.json`, unpacks into a temporary folder, and starts each new program once to see that it runs. Only then does it swap the files.
- **Roll back.** It puts the previous plugins and programs back from the one backup that the last update kept. Auto mode then skips the version you rolled back from. A version that failed is skipped by auto mode too, until a newer one appears.

What an update replaces:

- the seven kit plugins in `~/.arc/local-plugins`, and the copy of each in the profile folders (`~/.arc/profiles/<name>/node_modules`), because the app loads that copy;
- `arc-gateway.exe` where it is installed, and `arc-validators.exe` where a copy already exists.

What it never touches: your data in `~/.arc` (conversations, keys, settings), the app archive (`app.asar`), and plugins that are not in the kit.

The programs start with the next launch of Arc Harness. The panel asks you to restart; the app never closes itself. If a check after the swap fails, the update puts the old files back by itself and the panel says so.

A release that has no kit zip, such as `v0.5.0`, shows *no installable kit*. A kit built before the file digest list existed (`files` in `RELEASE-MANIFEST.json`) is refused, because its files cannot be checked one by one.

The checksum limit: the checksum file comes from the same release as the zip. It proves that the download is complete and was not changed on the way. It does not prove who built the kit. Anyone who can publish to the release can publish both files.

An update does not change the Electron shell. The app archive still comes from the build and install steps above.

Not tested: no update ran against the real GitHub release yet, because it needs a release newer than the installed one. The tests use a fake release server.

## Check which archive is installed

Run `node tools/install.mjs status`. It says one of three things: the original archive, the current Arc Harness build, or an archive that matches neither. It also says whether the update feed file is present.

## Go back

Run `node tools/install.mjs rollback`, or `install.cmd rollback`. It puts the original files back from `pristine/`: the archive, the two icons and the update feed file. It also restores the side folder and the runtime files. It does not touch your data folders.

## Uninstall

Use the uninstaller of the original app. Your data folder `.arc` in your user folder stays until you delete it. The old `.dsh` folder stays too.
Not tested: no check ran the uninstaller.

## If you keep the original archive somewhere else

The build and the install tool read only `pristine/app.asar`. They have no option for another path. Copy the file there.

## When something fails

See [Troubleshooting](Troubleshooting).
