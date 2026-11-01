# Arc Harness build kit

Arc Harness is the Arc Science build of the open-source (MIT) agent harness that shipped as DeepSeek Harness 0.2.1-rc.5.
This folder rebuilds the app archive from the pristine one, so every change is a script that can run again after an upgrade.

## Look

- Logo: the Arc Science AS cube (Omniverso/Brand cube AS 2026-10-19). One colour: #0A0A0A on light pages, white on dark pages. The plain cube mark shows at 32 px and below. The product name is live text in Geist 600.
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
| `brandtext/apply-profiles.mjs` | Applies the same rules and icon colors to the plugin packages of both profiles. `--restore` puts the originals back. |
| `theme/tune-arc-skin.mjs` | Second pass on the skin: paper canvas, white cards, sidebar `#f4f2ed`, readable captions, hidden update badge. |
| `test/` | `asar-roundtrip.mjs` proves the writer. `build-check.mjs` checks the built archive. `ui-strings.mjs` finds DeepSeek, DSH and Whale wording in text a person reads (archive and profiles). `ui-crawl.mjs` opens every main screen in a headless browser in light and dark and checks words, blue, contrast and the first-run look. `no-deepseek-net.mjs` and `net-trace.cjs` find and trace connections to DeepSeek services. |
| `policies/` | Plugin names, descriptions, icons and documents. `apply.mjs` writes them; `test.mjs` checks them. |
| `purge/` | Non-English files removed and Chinese text translated in the plugin packages. |
| `linkstrip/` | Outside links and source fields removed from plugin documents and package metadata. |
| `_legacy-*.tar.xz` | Archived legacy work (tile logo build, v0 and Radium skins). Not used. |

## Rebuild

```
PYTHONUTF8=1 python brand/build_brand.py
node tools/build.mjs
node test/build-check.mjs build/app.asar <scratch dir>
node tools/install.mjs install      (close the app first)
```

## Licence

The upstream code is MIT. Keep the licence and notice files inside the archive and the plugin folders. Geist is under the SIL Open Font License 1.1 (`brand/dist/GEIST-OFL.txt`).
