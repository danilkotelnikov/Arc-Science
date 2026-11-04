# Credits and licenses

Status: Works today. `NOTICE.md` in the main repository lists the same notices in one place.

## Credit to the original

Arc Harness is built on an MIT-licensed desktop agent app. Almost all of the app is that project's work. The README names it once, and `NOTICE.md` holds the licence text.
The upstream licence text and its copyright line are in the folder `THIRD_PARTY_LICENSES` in the main repository.

Arc Harness is an independent, unofficial project. It is not affiliated with or endorsed by the original publisher.
Real model names appear only as names of models.

## This repository

The kit is licensed under the MIT license, "Copyright (c) 2026 Arc Harness contributors". The file is `LICENSE`.
The AS cube logo is the exception. See "The AS cube logo" below.
The kit holds scripts, brand files, tests, the two Arc plugins and documents. It holds no part of the original app.

## The AS cube logo

The AS cube logo, and every picture, film or page of this repository that shows it, are not covered by the MIT license. Examples are the folders `brand/`, `media/` and `docs/images/`.
All rights are reserved by the project owner. The build uses the logo files unchanged. `NOTICE.md` gives the full rule.

## What the built app also contains

| Component | License | Notes |
|---|---|---|
| The original app, version 0.2.1-rc.5 | MIT | The app code. |
| Electron | MIT | The desktop runtime. The text is in `THIRD_PARTY_LICENSES/Electron-MIT.txt`. |
| Chromium | Several licenses | Listed in `LICENSES.chromium.html` in the folder of the installed app. |
| `@deepseek-ai/cordis` and `@deepseek-ai/cosmokit` | MIT, "Copyright (c) 2021-present Shigma" | The module system and the helper library inside the app. In a built archive they carry the names `@arc-harness/cordis` and `@arc-harness/cosmokit`. Each package carries its own `LICENSE` file, and the build leaves it unchanged. |
| Other packages inside `app.asar` from other authors | Each has its own | The license, notice and copying files of the original archive stay unchanged. |
| LibreOffice kit and other native modules | Their own | They sit in `app.asar.unpacked` next to the archive. The build does not touch them. |

## What this repository adds

| Component | License | Notes |
|---|---|---|
| Geist and Geist Mono typefaces | SIL Open Font License 1.1 | `brand/dist/geist.css` and the plugin `arc-theme` embed both as WOFF2 data. The product name in the app uses Geist. The license text is in `THIRD_PARTY_LICENSES/Geist-OFL-1.1.txt`. |
| The AS cube logo, and the pictures, films and pages that show it | Not covered by the MIT license. All rights are reserved by the project owner. | See "The AS cube logo" above. |

## The rule to keep

When you copy or redistribute the kit, or an archive built with it, keep these notices.
