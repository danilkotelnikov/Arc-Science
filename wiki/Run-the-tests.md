# Run the tests

Status: Works today. Five checks need nothing. Most others need the original archive and a build. The live tests need an installed app and run on Windows only.

## The desktop journey

`node test/desktop-journey.mjs` opens the desktop app on a throwaway copy of the desktop profile and uses real mouse clicks.

- `--mode settings` opens Settings and the Models page and checks the provider list.
- `--mode reply` sends a message and waits for a real model reply. It needs a working provider and uses a temporary copy of the credentials file, which is removed on every exit.
- `--mode retry` breaks the gateway address on purpose and checks the retry line.
- `--mode shots --theme light` writes the screens for these documents. Check each picture by eye before you publish it: a memory brief can hold private notes.

Pictures and a report go to `_scratch/journey`, or to the folder you name with `--out`.

## Tests that need nothing

```
npm test
cargo test --manifest-path native/arc-validators/Cargo.toml
```

`npm test` runs without the original archive on Node.js 22.19 or newer, and `cargo test` checks the zero-dependency Rust crate.

| Check | What it proves |
|---|---|
| `scripts/check-syntax.mjs` | Every `.mjs` and `.cjs` file parses. |
| `lib/arcnames.mjs` | The rename map gives the right Arc names. |
| `test/iconcolor.test.mjs` and `test/header.test.mjs` | Blue and violet icon fills are recolored, and `docs/images/header.svg` and `header-still.svg` stay safe. |
| `node --test plugins/*/test/*.test.mjs` | All six Arc plugins (`arc-hoh`, `arc-core`, `arc-theme`, `arc-mode`, `arc-molecullage`, `arc-mermaid`) pass their unit, gate, UI, and layout tests. |
| `test/package.test.mjs`, `test/lean-profile.test.mjs`, `test/arcunpacked.test.mjs`, `test/workflows.test.mjs`, `test/native-transition.test.mjs` | Installer staging, per-home undo lists, unpacked copy links, workflow security invariants, and Phase 6 native transition slices N0–N9 hold. |
| `tools/measure-start.mjs --self-test`, `tools/bench-runner.mjs --self-test`, `lib/testhome.mjs --selftest`, `scripts/privacy-scan.mjs --self-test` | Startup timer, headless benchmark runner, throwaway test home, and privacy scanner pass self-checks. |
| `cargo test --manifest-path native/arc-validators/Cargo.toml` | Rust SHA-256, prose rules, secret/path scans, hook guards, SVG vector bounds, network grants, and seal guards match golden vectors. |

GitHub Actions runs `npm test`, `cargo test --manifest-path native/arc-validators/Cargo.toml`, and `node scripts/privacy-scan.mjs` on every push and pull request in `.github/workflows/ci.yml`.

## Tests that need the original archive and a build

Build first. See [Build from source](Build-from-source). Then run each test from the kit folder.

```
npm run test:archive
```

The script makes the scratch folder `build/check`, because `build-check` puts its temporary folder inside it. The script runs `test/build-check.mjs build/app.asar build/check`, then `test/ui-strings.mjs`, `test/independent-scan.mjs` and `test/positive-control.mjs`. Two more tests run by hand:

```
node test/asar-roundtrip.mjs pristine/app.asar <scratch folder>
python test/image-scan.py --asar build/app.asar
```

These tests read their archive from a path argument or from the default. They have no `--pristine` option and no `ARC_PRISTINE` variable.

| Test | What it checks | A good result |
|---|---|---|
| `asar-roundtrip` | The archive writer. An unchanged repack equals the original byte for byte. An edit changes only its own file. | `ALL PASS` |
| `build-check` | The build against the original. Every changed script still parses. No old name or whale outline is left. Every other file is identical. The manifest hashes match. The brand files match `brand/dist/SHA256SUMS.txt`. Each promise of the build holds. | `ALL PASS` |
| `ui-strings` | Finds old brand wording in text a person reads, using the build's own rules. | `0 findings` |
| `independent-scan` | Does the same with its own patterns and its own string reader, so a gap in the build rules shows up. It checks itself first. | `0 findings` |
| `image-scan` | Reads pictures by content and finds the old vendor's whale or blue in them. See "The picture scan" below. | Exit code 0 |
| `positive-control` | Runs the scans on the original archive, where they must find a lot. A scan that reads nothing would pass the build, so this test fails it. | `ALL PASS` |

The independent scan keeps a separate count of names that wait for a later rename step. That count is not part of the findings.

`ui-strings` and `independent-scan` also read plugin packages with `--profiles`. They look in your data folder: `ARC_HOME`, then `~/.arc`, then `~/.dsh`. The option `--dsh-home <folder>` points them at another folder. The option keeps its old name.

## The picture scan

The text scans cannot see pictures, so `test/image-scan.py` reads them by content. It needs Python 3 and nothing else. Run it with `python`.

It reads image files (PNG, WebP, ICO, GIF, JPEG, BMP and AVIF). It also reads images embedded in scripts as base64 text, SVG files, inline SVG marks and plain SVG data URIs.
For each raster picture it takes the SHA-256 of the bytes and looks it up in `brand/pictures.json`. For each SVG it looks for the path of the old whale and for the old blue.
It also looks for the vendor's blue written as color text in scripts, styles and pages, such as a gradient stop.

The file `brand/pictures.json` has four keys: `note`, `whale`, `svgSwap` and `reviewed`.

- **whale.** Pictures that hold the old vendor's mark. One of these in the archive is always a failure.
- **svgSwap.** Preview pictures that show the old mark or name. Each one maps to a replacement file in `brand/dist/previews`.
- **reviewed.** Every other distinct picture of the original app and of the third-party plugins in a test profile, looked at one by one.

The scan adds a set of its own, "ours". It computes that set from `brand/dist`: the files in `tiles/` and the app icon. They pass without an entry in the file.

A picture that is on no list fails as "unreviewed". The scan cannot judge a picture by looking at it. A person reviews each new picture
and adds its SHA-256 to `brand/pictures.json`. Pictures inside third-party test, fixture, font and demo folders are only counted.

The scan stops with exit code 2 when it reads too little. `--floor-raster` and `--floor-text` set the minimum, and both default to 1. Use `--expect-findings 10` on the original archive for a positive control.
`--survey` lists every distinct raster picture of an archive, with no verdict. That is how you find the pictures a person has to review. Use `--dir <folder>` to add a folder, such as a profile, and `--self-check` to test the scan itself.

Known limits:

- A plugin's asset folder can hold screenshots and banners that show the old product name as text inside the picture. The scan cannot read that text.
  Those pictures are reviewed and allowed. This repository ships none of them.
- The scan does not judge the native files in `app.asar.unpacked`.
- The scan does not judge the third-party DevTools icons of the inspector package. It still checks them against the whale list first.

## Tests that need an installed app

These two start the installed app's Electron runtime as a plain Node host on a free local port. They do not open the app window.

```
node test/no-deepseek-net.mjs --live
node test/ui-crawl.mjs --lean
```

- They need the original app installed. The default folder is the install folder of the original app.
  `no-deepseek-net` takes `--install <folder>` for another. `ui-crawl` takes `--exe <program>`, or reads the environment variable `ARC_APP_DIR`.
- They test `build/app.asar`. Use `--archive <file>` with `no-deepseek-net` and `--asar <file>` with `ui-crawl` for another archive.
- They read the profile `profiles/web` of your data folder. They have no option for the folder. Set `ARC_HOME`, or let them use `~/.arc`.
- They never write to that data folder. They copy the profile files and hard-link the plugin packages into a throwaway folder, and they fail if a real file changed.
- `ui-crawl` also needs Microsoft Edge or Google Chrome in its standard install folder.
- The live trace sees Node connections only. A helper started by a plugin, such as a Python program, is outside it.

`no-deepseek-net` without `--live` is a static census. It reads the archive, both profiles, the local plugins and the installed runtime. It fails when it reads too few files, so it needs a real data folder with both profiles. An empty folder fails.
`npm run test:archive` does not run it.

`ui-crawl` runs three phases, each on its own server and its own throwaway home: first run, dark and light. It checks every main screen for old wording, blue colors and text contrast below 3 (a contrast below 4.5 is a warning).
It also checks that the first-run page is the paper `#faf9f6` and that the dark set is `#171614`. The paper and dark checks expect the look of the theme plugin, so the profile you test should carry `arc-theme`.
With `--lean` it opens only the screens of the lean core and checks that the removed screens are gone. It also checks that the right sidebar has a Trace tab with the Harness of Harness ledger.
Use `--plugin plugins/arc-hoh` to test a plugin from its source folder. The option can repeat. `--phase first-run`, `--phase dark` or `--phase light` runs one phase, `--out <folder>` sets the folder for pictures and `report.json`, and `--keep` leaves the server running.

## What the tests do not cover

- The text scans skip pictures and the binary files in `app.asar.unpacked`. `ui-strings` skips archive files over 6 MB. `independent-scan` only searches files over 12 MB for old names. The picture scan reads pictures but cannot read words drawn inside them.
- No test starts the welcome window or the installer.
- Only the `reply` and `shots` modes of the desktop journey run a model, and only with a provider you already set up.

## Privacy scan

The privacy scan checks the files of the repository. It looks for e-mail addresses, home paths with a user name, public IP addresses, private keys and token shapes.
It also reads an optional private deny-list of terms.
Run it with `npm run scan`. It exits with 0 when it finds nothing. [Privacy and security](Privacy-and-security) describes it.
