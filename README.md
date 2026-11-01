# Arc Harness build kit

Arc Harness is the Arc Science build of the open-source (MIT) agent harness that shipped as DeepSeek Harness 0.2.1-rc.5.
This folder rebuilds the app archive from the pristine one, so every change is a script that can run again after an upgrade.

## Look

- Logo: the Arc Science AS cube (Omniverso/Brand cube AS 2026-10-19). One colour: #0A0A0A on light pages, white on dark pages. The AS cube is the logo at every size (the owner asked for it on 2026-11-01); only the moving "running" indicator in the chat keeps the plain cube, because it is an animation. The product name is live text in Geist 600.
- Theme: the cream C2 look of the Cammut and Arc Science console (Omniverso/Cammut + Arc Science UI preview 2026-10-23). Paper #faf9f6, dark-brown primary #54453c, Geist, 10 px cards, 8 px controls. No blue.

## Folders

| Folder | Content |
|---|---|
| `pristine/` | The original `app.asar`, `app-update.yml`, `icon.png`, `tray.ico` with `SHA256SUMS.txt`. Never edited. |
| `lib/asar.mjs` | Reader and writer for the archive format. A repack without changes equals the original byte for byte. |
| `brand/build_brand.py` | Builds cube paths, favicons, `icon.png`, `tray.ico` and `geist.css` from the brand cube folder and the C2 file (read only). |
| `theme/make-arc-skin.mjs` | Turns the theme plugin into the single Arc Science skin from the C2 values. |
| `tools/build.mjs` | Applies the patches to the pristine archive and writes `build/app.asar`. Each patch checks how many places it changed. |
| `tools/install.mjs` | `install`, `rollback` and `status` for the app folder. `install.cmd` wraps it. |
| `tools/asar-cat.mjs` | Prints or lists files inside an archive. |
| `lib/brandrules.mjs` | One rule set for brand text: DeepSeek, DSH and Whale wording becomes Arc Harness, and DeepSeek addresses become `arc-harness.invalid`. Real model names stay. The build rewrites with it and the tests check with it. |
| `lib/iconcolor.mjs` | Recolors blue and purple icon fills to ink and warm grey. |
| `brandtext/apply-profiles.mjs` | Applies the same rules and icon colors to the plugin packages of both profiles, the local plugins and `local-gateway.mjs`. `--restore` puts the originals back. |
| `brandtext/apply-unpacked.mjs` | Removes the old vendor's repository and homepage links from the `package.json` files in the installed app's unpacked folder. `--restore` puts the originals back. |
| `theme/tune-arc-skin.mjs` | Second pass on the skin: paper canvas, white cards, sidebar `#f4f2ed`, readable captions, hidden update badge. |
| `test/` | `asar-roundtrip.mjs` proves the writer (run it with the pristine archive and a scratch folder). `build-check.mjs` checks the built archive, hashes included. `ui-strings.mjs` finds DeepSeek, DSH and Whale wording with the build rules; `independent-scan.mjs` does it again with its own patterns and counts the lowercase command and provider names that the rename slices will remove. `ui-crawl.mjs` opens every main screen in a headless browser in three separate phases (first run, Dark, Light), each on its own throwaway data home, and checks words, blue, contrast and the first-run look; a screen may be skipped only with a stated reason. `no-deepseek-net.mjs` and `net-trace.cjs` find and trace connections to DeepSeek services; `--live` starts the archive under test and fails on any host other than this machine. `positive-control.mjs` runs the scans on the pristine archive, where they must find a lot, so a scan that reads nothing fails. `profile-state.mjs` ties a test run to one state of the data home: it checks the hash list in `brandtext/profile-state.json` and the profile settings. |
| `policies/` | Plugin names, descriptions, icons and documents. `apply.mjs` writes them; `test.mjs` checks them. |
| `purge/` | Non-English files removed and Chinese text translated in the plugin packages. |
| `linkstrip/` | Outside links and source fields removed from plugin documents and package metadata. |
| `_legacy-*.tar.xz` | Archived legacy work (tile logo build, v0 and Radium skins). Not used. |

## What the tests cover, and what they do not

- The static scans read text files, JSON values, script strings, SVG text, YAML and PowerShell help in the archive and in both profiles. They do not read pictures (PNG, WebP), the binary files in `app.asar.unpacked` (the LibreOffice kit and its notices stay), or files over 12 MB.
- The live trace and the screen crawl run the **web profile** of the candidate archive on a throwaway data home, in Node and in headless Edge. The Electron main process, the desktop window, the menus, the welcome window and the installer were never started by any test. The welcome window is checked only by the build (`build-check.mjs`). They are checked by hand after an install.
- The live trace sees Node connections only. A helper started by a plugin (Python, for example) and the local gateway's own relays are outside it. The test configuration switches the MCP client rows off, so the run does not touch Cammut or Composio.
- Names that stay until the rename slices: the command `dsh`, the folder `.dsh`, the Documents folder `deepseek-harness`, `@deepseek-ai/*` and `dsh-*` package names, `DSH_HOME`, the exe and installer names, the `dsh-session-*.zip` export name. The independent scan reports them as "names that wait for the rename slices". A lower-case `dsh` in a sentence is not one of them: that fails.
- Third-party plugin packages that are switched off (the remote plugin, the skill badge, the account plugin) are not shown, but the badge and account assets were rewritten anyway.

## Rebuild

```
PYTHONUTF8=1 python brand/build_brand.py
node tools/build.mjs
node test/build-check.mjs build/app.asar <scratch dir>
node tools/install.mjs install      (close the app first)
```

## Licence

The upstream code is MIT. Keep the licence and notice files inside the archive and the plugin folders. Geist is under the SIL Open Font License 1.1 (`brand/dist/GEIST-OFL.txt`).


See `PROFILE-CHANGES.md` for every change made outside this folder and how to undo it.
