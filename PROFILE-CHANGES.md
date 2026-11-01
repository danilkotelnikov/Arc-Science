# Changes outside this folder (2026-11-01, slice S022)

These files belong to the Arc Harness data home (`C:\Users\danil\.dsh`). They are not in git. Each change has an archive or a script.

| Where | Change | How to undo |
|---|---|---|
| `profiles\web\cordis.patch.yml` | Default model is Radium HAL 1.0 (was a DeepSeek model through the Merge gateway). | Copy `.dsh\_archive-web-patch-20261101b.yml` back. |
| `profiles\desktop\cordis.patch.yml` | The two `deepseek-official` entries leave the subagent model list. | Copy `.dsh\_archive-desktop-patch-20261101b.yml` back. |
| `profiles\web\cordis.patch.yml` | A `ui-theme: preference: dark` block that an early version of `test/ui-crawl.mjs` wrote by mistake was removed again. The crawl now works on a copy and fails if a real profile file changes. | Not needed. |
| Plugin packages in both profiles and `local-plugins` | Brand text, dead DeepSeek addresses, ink-colored icons, no npm registry check in `dsh-context` and `dsh-vision-router`. | `node brandtext/apply-profiles.mjs --restore` (originals in `brandtext/_originals.tar.xz`). |
| `local-plugins\dsh-theme-pair` and its copies in both profiles | Skin layers (paper canvas, white cards, sidebar `#f4f2ed`), readable captions, hidden update badge. | `theme/make-arc-skin.mjs` keeps `_legacy-skins-20261101.tar.xz`. |
| The installed app | `tools/install.mjs install` swaps `app.asar`, `icon.png`, `tray.ico` and removes `app-update.yml`. `rollback` undoes it. | `node tools/install.mjs rollback` |

Not changed (needs Danil's decision): the home folder name `.dsh`, the Documents folder `deepseek-harness`, the Electron settings folder, the `dsh` command, the exe and installer names, and the internal module names `@deepseek-ai/*` and `dsh-*`.
