# Troubleshooting

Status: Partly. The messages below are the real messages of the tools. The causes are what the code checks. Not every case was reproduced.

## The build stops with a file-not-found error for pristine/app.asar

The tool cannot find the original `app.asar`. Copy it from the `resources` folder of an installed copy of the original app, version 0.2.1-rc.5 to `pristine/app.asar`.
The build has no option and no environment variable for another path. [Install](Install) lists the four files to copy.

## "patch failed: the original app.asar.unpacked (with its dsh folder) was not found"

The build needs the original side folder. It looks in `pristine/app.asar.unpacked` and then in the `resources` folder of the installed app.
The folder must hold the original `dsh` folder. If you installed the Arc build already, the original folder moved to `pristine/app.asar.unpacked`. If the app is installed elsewhere, set `ARC_RESOURCES`.

## "patch failed: ... expected 1 match, found 0"

A patch did not find the text it changes. The archive is a different build, or an earlier build already changed it.
Always build from the original archive, never from a built one. Compare `pristine/app.asar` with `pristine/SHA256SUMS.txt`.

## "pristine file changed: ..."

A file in `pristine/` does not match `pristine/SHA256SUMS.txt`. Copy the file again from a clean installation of the original 0.2.1-rc.5.

## "the live app.asar is neither the original nor a known Arc build; stop and look"

`install` refuses to replace an archive it does not know. Someone or something changed `app.asar`, for example an update of the original app.
Run `node tools/install.mjs status`. If the app updated itself, reinstall version 0.2.1-rc.5, copy its files into `pristine/` again and start over.

## "no build/app.asar; run tools/build.mjs first"

`install` needs a build. Run `node tools/build.mjs`. The message "no build/app.asar.unpacked/arc" has the same cure.

## "pristine/app.asar.unpacked exists already; look before installing"

An earlier install moved the original side folder there. Run `node tools/install.mjs rollback` first, or check the folder and remove it by hand.

## "an unfinished copy is in the way"

An earlier copy of the data folder stopped half way. The message names the folder with the ending `.arc-new`. Look at it, then remove it and run `install` again.

## The install fails with EBUSY or EPERM

Windows locks the archive while the app runs. Close the app, including its tray icon, and run the command again.

## The app shows none of my old sessions

The app now reads `~/.arc`. The first install copies `~/.dsh` there, but only when `~/.arc` has no `profiles` folder yet. The tool prints "data folder: ... (already there)" when it skips the copy.
Set `ARC_HOME` to the folder you want the app to use.

## The app still has the old name in the Start menu and the file name

`install.cmd` patches `resources/app.asar` inside the existing install folder, so the old executable file name and Start menu shortcut stay unless you build the standalone `Arc Harness.exe` layout with `node tools/package.mjs` and `installer/arc-harness.iss`. See "What stays" in [Build from source](Build-from-source).

## The app looks different from the screenshots

The screenshots show the cream paper skin. It comes from the plugin `plugins/arc-theme`. Copy it into your profile, then run `node tools/lean-profile.mjs apply` so the bundle list names it. See [Look and feel](Look-and-feel).

## There is no Plugins page

The lean core switches it off. Install plugins by copying them into `~/.arc/profiles/<profile>/node_modules` and adding them to the bundle list. See [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).

## lean-profile.mjs says "no profile at ..."

The tool looks for `profiles/web` and `profiles/desktop` in your data folder. Pass `--home <folder>` or set `ARC_HOME`.

## No model answers

Open Settings, then Models. Check that your provider shows "API key configured". See [Add your API keys](Add-your-API-keys).
If you use a custom provider, check the base URL and the API protocol.

## The agent cannot write a file

Check the permission mode in the text box. Workspace Write lets the agent write only inside the workspace. See [Privacy and security](Privacy-and-security).

## I want to undo everything

Run `node tools/install.mjs rollback`. It restores the original archive, icons, update feed file, side folder and runtime files. Your data folders are not touched.

## A test says "no Edge or Chrome found" or "FAIL: too few files read"

`ui-crawl` needs Microsoft Edge or Google Chrome in its standard install folder. `no-deepseek-net` and `ui-crawl` need the installed app and a real data folder with `profiles/web`. Pass `--install <folder>` or `--exe <program>`, and set `ARC_HOME`. See [Run the tests](Run-the-tests).

## A live test says a throwaway home could not be removed

A process still holds the folder. Stop it, then remove the folder by hand. The message names the folder.

## The privacy scan reports a finding

Read the file and line it prints. Remove the personal data or the key. If the line is a documentation example, add the marker `privacy-scan: allow` to the same line.
Never add the marker to a real secret.

## Still stuck

Open an issue with the bug report template. Remove keys, tokens and folder names that contain your name from anything you paste.
