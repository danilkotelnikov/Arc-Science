# Build from source

Status: Works today. The build is plain Node.js. It was run against the Windows archive of the original app, version 0.2.1-rc.5 only.

The kit does not contain the app. It builds Arc Harness from the original app archive that you supply.

## What you need

- Node.js 22.19 or newer and Git.
- The original `app.asar` of the original app, version 0.2.1-rc.5. It sits in the `resources` folder of an installed copy. The build also needs the `app.asar.unpacked` folder next to it.
- Python 3 for the picture scan `test/image-scan.py`. It uses the standard library only. The brand file builder `brand/build_brand.py` also needs the package Pillow.

The original archive is 182,766,714 bytes. Its SHA-256 is `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`. The same value is in `pristine/SHA256SUMS.txt`.
A different archive is a different build. The patches then fail on purpose.

## Where the original archive goes

The build reads `pristine/app.asar` in the kit folder. It has no option and no environment variable for another path.
It reads the original `app.asar.unpacked` folder from `pristine/` first. If that is missing, it reads the one in the `resources` folder of the installed app. Set `ARC_RESOURCES` when that folder is not in the default place. The folder must hold the original `dsh` folder.
The easy way to fill `pristine/` is to copy the four files by hand. [Install](Install) shows the steps.

The `.gitignore` excludes `pristine/app.asar`, the two icons in `pristine/`, every `.asar` file and every `.asar.unpacked` folder. `pristine/SHA256SUMS.txt` is committed. Do not commit the other files you copy there.

## Build

```
node tools/build.mjs [out.asar]
```

The output path is optional. Without it, the build writes `build/app.asar`.
It also writes `BUILD.json` next to the output. That file holds the SHA-256 of the build and the report of every patch. The side folder `build/app.asar.unpacked` holds hard links and rewritten texts of the original side folder.

## What the build does

Every patch counts the places it changed. If the count is not what the patch expects, the build stops with "patch failed". The archive is written only after every patch has passed.

| Patch | What it does |
|---|---|
| Logo | Replaces the whale logo components in the web frontend with the AS cube and the live-text name. |
| Hero | Replaces the swimming whale on the home screen with a large cube. |
| Running indicator | Replaces the animated whale with the plain cube. |
| Product name | Rewrites the old product name in the files a person reads and in 11 fixed sentences. |
| Package metadata | Removes repository, homepage, bugs and funding links from the app's own packages. |
| Web manifest | Sets the name and both favicons. |
| Chinese texts | Replaces Chinese dictionary values by their English twins, replaces the Chinese locale files by English copies, and removes the Chinese documents. |
| Brand text | Rewrites old brand wording in prose and strings. Real model names stay. |
| Icons and blue | Recolors blue and purple fills, the vendor's blue literals and every blue hue in the app's own screens. |
| Pictures | Replaces pictures that hold the old whale or the old blue. See "Pictures" below. |
| Vendor services | Removes the direct vendor provider from the registry, makes vendor addresses unresolvable, switches off three telemetry rows, and gives dormant plugins plain names. |
| Account screenshots | Replaces eight embedded screenshots of the account screen by a transparent pixel. |
| Welcome window | Skips it at startup and recolors it. |
| First-run look | Sets the default appearance to Light. |
| Updates | Switches the update coordinator off, whatever files sit next to the app. |
| Badge skill | Gives the badge skill the cube tile and Arc Harness wording. |
| Running label | Shows "Thinking" and "Thinking for 2s" in place of "Deep diving". |
| Lean core | Switches off ten browser rows: the plugin manager and its pages, Automation tasks, trajectories, skills, account, subagent settings, the Agent presets page and the mode picker. |
| Coding view row | Removes the "Show coding view" row from General settings. |
| Data folder | Moves the data folder to `~/.arc` and its variable to `ARC_HOME`. |
| Clean room | Moves every internal name to Arc. See "Internal names" below. |
| Manifest | Updates the size and hash of every changed file in the runtime manifest. |

The counts in `BUILD.json` can change when a rule changes.

## The rules

`lib/brandrules.mjs` holds one rule set for brand text. The build rewrites with it. The tests check with it.
Vendor addresses become `arc-harness.invalid`. The top-level name `.invalid` can never resolve, so no code path can reach the old service.

## Internal names

`lib/arcnames.mjs` holds one rename map. The build applies it to the archive, and the installer applies it to the copied data folder.

| Old | New |
|---|---|
| `@deepseek-ai/dsh-chat` | `@arc-harness/arc-chat` |
| `dsh/node_modules` and `dsh-x` | `arc/node_modules` and `arc-x` |
| `DSH_HOME` | `ARC_HOME` |
| `.dsh`, the `dsh` field of `package.json`, the command `dsh` | `.arc`, the `arc` field, the command `arc` |

A match never starts or ends inside a word, so words such as `handshake` stay. Long base64 text is left alone.
The build ends with a check. It stops if one old name is left in a text file of the archive.

## Pictures

The text rules cannot change a picture. A separate step swaps the pictures that show the old vendor's whale or blue. It has three parts.

- **PNG files** in the archive that hold the whale are found by the SHA-256 of their bytes. Each is replaced by one of five files in `brand/dist/tiles`. The build stops if it finds none.
- **Pictures inside scripts** are swapped by the brand rules in `lib/brandrules.mjs`. This covers base64 images, inline SVG marks, the whale's path data, and blue in embedded SVG pictures.
- **Preview pictures** of the plugin manager are replaced by the two files in `brand/dist/previews`.

`lib/whaleimg.mjs` does the swapping. `brand/pictures.json` lists the pictures it knows. A person looked at every distinct picture of the original app and of the third-party plugins in a test profile to make that list.
[Run the tests](Run-the-tests) describes the picture scan that checks the result. A new picture must be reviewed by a person and added to the list.

## Rebuild the brand files

```
python brand/build_brand.py
```

The script reads the AS cube and the Geist fonts from a folder outside this repository. Set `ARC_BRAND_SRC` to that folder and `ARC_SVG2PNG` to the rasteriser program. It needs Pillow.
It writes these files to `brand/dist`:

- `brand.json`, the cube and favicon SVG files, `geist.css` and `GEIST-OFL.txt`,
- `icon.png`, a cream tile with the cube, and `tray.ico`,
- the five pictures in `tiles/` and the two in `previews/`.

It also writes `brand/dist/SHA256SUMS.txt`, which holds the SHA-256 of 14 of these files. `test/build-check.mjs` checks them.

The files in `brand/dist` are committed as built, byte for byte.
`.gitattributes` stops Git from changing their line endings, so the hashes stay the same on every machine.

## Install the build

[Install](Install) shows the steps. `tools/install.mjs` has three commands: `install`, `rollback` and `status`.

## Look inside an archive

```
node tools/asar-cat.mjs pristine ls "licen"
node tools/asar-cat.mjs build cat package.json
node tools/asar-cat.mjs build cat arc/node_modules/@arc-harness/arc-mcp-client/README.md
```

The first word is `pristine` or `build`. The tool reads `pristine/app.asar` or `build/app.asar`. The pattern after `ls` is a JavaScript regular expression and ignores case.
The built archive uses the Arc paths: `arc/node_modules/@arc-harness/arc-<name>`. The original archive uses `dsh/node_modules/@deepseek-ai/dsh-<name>`.

## What stays

The build changes the names that a person reads, and the internal names listed above. These stay:

- the original program file name, the install folder and the Start menu name of the installed app,
- the design-token prefixes `dsw-` and `ds-` of the original interface,
- the ids of real models in the third-party model catalog.

## Limits

- The build changes the archive. It does not change the Electron runtime, Chromium or the native modules next to the archive.
- The patches target one build. A different version needs new patches.
- The desktop window, the menus and the installer are not started by any test.
