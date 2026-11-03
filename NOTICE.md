# Notice

Arc Harness is based on DeepSeek Harness 0.2.1-rc.5. DeepSeek Harness is published by DeepSeek under the MIT license.
The upstream project is at <https://github.com/deepseek-ai/deepseek-harness>.
The upstream license text and its copyright line, "Copyright (c) 2026 DeepSeek", are in
[THIRD_PARTY_LICENSES/DeepSeek-Harness-MIT.txt](THIRD_PARTY_LICENSES/DeepSeek-Harness-MIT.txt).

"DeepSeek" and "DeepSeek Harness" are names of their owners. Arc Harness is an independent, unofficial project.
It is not affiliated with, endorsed by, or sponsored by DeepSeek. Real DeepSeek model names appear in this project only as names of models.

## What this repository contains

This repository holds the build kit: scripts, brand files, tests and documents. The code in the kit is licensed under the
MIT license in [LICENSE](LICENSE), copyright "Arc Harness contributors". The AS cube logo and the pictures, films and pages that show it are an exception.
See "The AS cube logo" below.

It does not contain DeepSeek Harness. You supply the original `app.asar` from your own installation. The kit reads it, changes
a copy, and writes a new archive on your machine. The original archive is never uploaded, committed or redistributed here.

## The AS cube logo

The AS cube logo, and every picture, film or page of this repository that shows it (`brand/`, `media/`, `site/`, `docs/img`), are not covered by the MIT license.
All rights are reserved by the project owner. The build uses the logo files unchanged. No license header is added to them.

## What the built app contains

The archive you build still holds the upstream code, changed as described in the wiki page "Build from source". These notices apply to it.

| Component | License | Where the text is |
|---|---|---|
| DeepSeek Harness 0.2.1-rc.5, the app code | MIT | [THIRD_PARTY_LICENSES/DeepSeek-Harness-MIT.txt](THIRD_PARTY_LICENSES/DeepSeek-Harness-MIT.txt) |
| Electron, the desktop runtime in the original installer | MIT | [THIRD_PARTY_LICENSES/Electron-MIT.txt](THIRD_PARTY_LICENSES/Electron-MIT.txt) |
| Chromium, inside Electron | Several licenses | `LICENSES.chromium.html` in the original installer's app folder. The build does not touch it. |
| `@deepseek-ai/cordis` and `@deepseek-ai/cosmokit`, the module system and the helper library inside the app | MIT, "Copyright (c) 2021-present Shigma" | The `LICENSE` file of each package inside the archive. The build leaves them unchanged. |
| The other packages inside `app.asar` that come from other authors | Each package has its own | The license, notice and copying files of the original archive. The build keeps them unchanged. |
| LibreOffice kit and other native modules in `app.asar.unpacked` | Their own | The notice files next to them in the original installer. The build does not touch them. |

## What this repository adds

| Component | License | Where the text is |
|---|---|---|
| Geist and Geist Mono typefaces. The page `site/preview.html` embeds subsets of both as WOFF2 files. The product name in the app is set in Geist when it is installed on the machine. | SIL Open Font License 1.1 | [THIRD_PARTY_LICENSES/Geist-OFL-1.1.txt](THIRD_PARTY_LICENSES/Geist-OFL-1.1.txt). No other file of this repository ships font files. |
| The AS cube logo, and the pictures, films and pages that show it | Not covered by the MIT license. All rights are reserved by the project owner. | See "The AS cube logo" above. |

Keep these notices when you copy or redistribute any part of the kit or of an archive built with it.
