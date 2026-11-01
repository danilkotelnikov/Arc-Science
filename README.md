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
| `lib/whaleimg.mjs`, `brand/pictures.json` | Replaces pictures that hold the old vendor's whale or blue: PNG files and data URIs found by the sha256 of their bytes, inline SVG marks and icon path strings found by their path, and the plugin manager's preview pictures (`brand/dist/previews`). The list was made by looking at every distinct picture of the original app and its ten plugins. |
| `brandtext/apply-profiles.mjs` | Applies the same rules and icon colors to the plugin packages of both profiles, the local plugins and `local-gateway.mjs`. `--restore` puts the originals back. |
| `brandtext/apply-unpacked.mjs` | Removes the old vendor's repository and homepage links from the `package.json` files in the installed app's unpacked folder. `--restore` puts the originals back. |
| `theme/tune-arc-skin.mjs` | Second pass on the skin: paper canvas, white cards, sidebar `#f4f2ed`, readable captions, hidden update badge. |
| `test/` | `asar-roundtrip.mjs` proves the writer (run it with the pristine archive and a scratch folder). `build-check.mjs` checks the built archive, hashes included. `ui-strings.mjs` finds DeepSeek, DSH and Whale wording with the build rules; `independent-scan.mjs` does it again with its own patterns and counts the lowercase command and provider names that the rename slices will remove. `ui-crawl.mjs` opens every main screen in a headless browser in three separate phases (first run, Dark, Light), each on its own throwaway data home, and checks words, blue, contrast and the first-run look; a screen may be skipped only with a stated reason. `no-deepseek-net.mjs` and `net-trace.cjs` find and trace connections to DeepSeek services; `--live` starts the archive under test and fails on any host other than this machine. `positive-control.mjs` runs the scans on the pristine archive, where they must find a lot, so a scan that reads nothing fails. `profile-state.mjs` ties a test run to one state of the data home: it checks the hash list in `brandtext/profile-state.json` and the profile settings. |
| `policies/` | Plugin names, descriptions, icons and documents. `apply.mjs` writes them; `test.mjs` checks them. |
| `purge/` | Non-English files removed and Chinese text translated in the plugin packages. |
| `linkstrip/` | Outside links and source fields removed from plugin documents and package metadata. |
| `_legacy-*.tar.xz` | Archived legacy work (tile logo build, v0 and Radium skins). Not used. |

## What the tests cover, and what they do not

- The static text scans read text files, JSON values, script strings, SVG text, YAML and PowerShell help in the archive and in both profiles. They do not read pictures, the binary files in `app.asar.unpacked` (the LibreOffice kit and its notices stay), or files over 12 MB.
- `test/image-scan.py` reads pictures by content: PNG, WebP, ICO, GIF and JPEG files and base64 data URIs, SVG files, inline SVG and SVG data URIs. It fails on a whale picture (exact sha256 list), on the vendor blue, on a known preview picture, and on any raster picture that nobody has reviewed (`brand/pictures.json`). It cannot tell what a new picture shows; a person has to look at it and add it. Screenshots and banners in plugin asset folders carry the old product name as picture text. They are reviewed and allowed: the plugin documents do not link to them and no screen of the crawl shows them, but the crawl does not open every plugin page, so they stay a known limit. It also looks for any blue or violet colour by hue (hex, rgb and rgba, in scripts, styles, pages and SVG files). The hue check reads #rrggbb and #rrggbbaa, rgb() and rgba() with commas or spaces, hsl(), hwb(), oklch(), lch(), oklab() and lab() in scripts, styles, pages, SVG and JSON files, named colours in style declarations (in a page only inside style blocks and style attributes, so prose does not count), SVG and markup colour attributes (fill, stroke, color, bgcolor, also in a page and in SVG data URIs) and script colour properties (also with a quoted key, as in JSON), and the shorthand #rgb and #rgba in declarations and colour attributes; every match counts, not only the first. Comments of a style file are not read, but a comment mark inside a string or url() does not start a comment, and a string that is never closed stays visible to the end of its line. It does not read a colour written straight after a word (`solid#36f`), the shorthand in JSON, style declarations inside SVG files (`style="fill:#36f"` or a `<style>` block in an .svg file), colour attributes with spaces around the equals sign or without quotes (`color = "#36f"`, `color=#36f`), unquoted style attributes, `flood-color` and `lighting-color`, an unclosed `<style>` block, and hsl() in turn or radian units, color(), a colour built from a template string (the Context Insights member colour was changed by hand for that reason), a colour inside a calc() or var() expression, the shorthand #rgb in scripts, colours in .md and .ts files, or non-vendor blues inside base64 SVG pictures. `test/iconcolor.test.mjs` tests the recolor. Third-party code and palettes that must keep their colours are listed with reasons in `test/image-scan.py` (HUE_ALLOW): the DevTools frontend, the terminal palette, vendor bundles, diagram, chart, editor and icon libraries, the Visualize chart palettes, the spreadsheet and PDF viewers, and the switched-off remote plugin. The spreadsheet viewer keeps only the blue colours of its chart palettes, colour pickers and hyperlink cells, the near-white toolbar background `#fafafc`, and example colours named in its help text. `test/build-check.mjs` pins the exact set of its blue colours written as hex (3 to 8 digits), rgb() or hsl() with percent (24 hex colours and one rgb colour, each with its count). Any other blue in those forms, or a second use of a palette colour, fails the build check. The fingerprint does not tally named colours, oklch, lab, hwb, color(), hsl() in turn or radian units, rgb() with percent or decimals, or a colour built in script; the viewer file holds none of them today. The scan skips three places: the translation tool's folder of old copies (`local-plugins/dsh-english`, which no profile loads), the unpacked native files (`app.asar.unpacked`), and the DevTools icons of the inspector package (third-party artwork). In the last place only an exact sha256 match with the whale list is caught. Third-party test, fixture and font pictures are counted, not judged.
- The live trace and the screen crawl run the **web profile** of the candidate archive on a throwaway data home, in Node and in headless Edge. The Electron main process, the desktop window, the menus, the welcome window and the installer were never started by any test. The welcome window is checked only by the build (`build-check.mjs`). They are checked by hand after an install.
- The live trace sees Node connections only. A helper started by a plugin (Python, for example) and the local gateway's own relays are outside it. The test configuration switches the MCP client rows off, so the run does not touch Cammut or Composio.
- Names that stay until the rename slices: the command `dsh`, the folder `.dsh`, the Documents folder `deepseek-harness`, `@deepseek-ai/*` and `dsh-*` package names, `DSH_HOME`, the exe and installer names, the `dsh-session-*.zip` export name. The independent scan reports them as "names that wait for the rename slices". A lower-case `dsh` in a sentence is not one of them: that fails.
- The remote plugin is third-party and switched off in both profiles. The skill badge and the account plugin are bundled with the app and switched off; the account plugin is still listed on the Plugins page. Their badge and onboarding assets were rewritten anyway.
- The shared-rule scan of the archive skips files over 6 MB (third-party libraries). The independent scan reads whole files up to 12 MB, and checks bigger ones as one text.
- The throwaway data home of the live trace and the crawl hard-links the plugin files. A plugin that writes into its own folder would change the real file; the real files are hashed before and after, and the run fails if one changed.

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
