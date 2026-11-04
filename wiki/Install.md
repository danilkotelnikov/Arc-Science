# Install

Status: Partly. The kit builds and installs on Windows. The desktop window, the menus and the installer are not started by any check. macOS and Linux are not tested.

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
9. Start the app from its usual shortcut. The installed app keeps the original program file name, install folder and Start menu name.
10. Install the two Arc plugins. Use the app's own plugin command, or copy `plugins/arc-hoh` and `plugins/arc-theme` into `~/.arc/profiles/<profile>/node_modules`. The plugin manager is switched off in the lean core, so copying is the usual way.
11. Close the app and run `node tools/lean-profile.mjs apply`. It keeps four bundles in the profile: `@arc-harness/arc-base`, `@arc-harness/arc-web-app`, `arc-theme` and `arc-hoh`. Run `node tools/lean-profile.mjs restore` to undo it. A plugin loads only when the bundle list names it, and this step adds both. It stops, and changes nothing, if a plugin is missing from a profile. Copy the plugins into both `web` and `desktop`.

## The data folder

The app keeps its data in `~/.arc`. Set `ARC_HOME` to move it.
The first install copies the old `~/.dsh` there. Settings, profiles, plugins and skills get Arc names. Conversations, logs and keys are copied byte for byte.
`~/.dsh` stays as it was, so `install.cmd rollback` gets the original app back with its data.
The copy runs only when `~/.dsh` exists and `~/.arc` has no `profiles` folder yet.

## Where the app folder is

The tools look for the app in the `resources` folder of the original app. That is where the official installer puts it.
If yours is elsewhere, set the environment variable `ARC_RESOURCES`. The live tests read `ARC_APP_DIR` for the folder that holds the program. [Run the tests](Run-the-tests) has the details.

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
