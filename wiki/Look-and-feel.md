# Look and feel

Status: Partly. The AS cube, the ink icons and the Light first run come from the build. The cream paper skin comes from the plugin `plugins/arc-theme`, which you install by copying.

The pictures `docs/images/light-home.png`, `docs/images/dark-home.png` and `docs/images/light-settings-general.png` in the main repository show the result.

## The AS cube

The logo is a cube with the letters A and S on its left face. It has one color: `#0A0A0A` on light pages and white on dark pages.
The build uses it in these places:

- the logo in the sidebar, at every size,
- the large cube on the home screen of an empty session. It turns to its other face when you hover over it,
- the favicons of the web client and the app icon, which is a cream tile with the cube on it,
- the small running indicator in a session. This one is the plain cube without letters. It is an animation.

The files are in `brand/dist`. They are committed as built, and `brand/dist/SHA256SUMS.txt` holds the SHA-256 of 14 of them. The script `brand/build_brand.py` can write them again. It needs the brand source files and a picture rasteriser, which live outside this repository. It reads their locations from `ARC_BRAND_SRC` and `ARC_SVG2PNG`. It also needs the Python package Pillow.

## The product name

The name "Arc Harness" is live text. It is set in Geist at weight 600. If Geist is not available, the app falls back to the system sans-serif font.
The theme plugin embeds Geist and Geist Mono. Both are free under the SIL Open Font License 1.1. The license text is in `THIRD_PARTY_LICENSES/Geist-OFL-1.1.txt`. See [Credits and licenses](Credits-and-licenses).

The logo is not covered by the MIT license. The same page explains this.

## Icons

Icons that were blue or purple are now ink, mid gray or a light paper tone, chosen by their lightness. Neutral colors stay as they were.
The kit has a rule for this in `lib/iconcolor.mjs`. `node test/iconcolor.test.mjs` tests it.

## Light and dark

A new data folder starts in the Light appearance. You can choose Light, Dark or System in Settings, General, Appearance.
The original app started in System. The build changes that one default and leaves the rest of the setting alone.

## The cream paper skin

The plugin `plugins/arc-theme` (`0.6.0`) provides three themes selectable in Settings, General, Theme: **Arc Harness** (cream paper `#faf9f6`, sidebar `#f4f2ed`, primary `#54453c`, warm dark `#171614`, 10 px cards and 8 px controls), **Black and white**, and **Radium**. None carry blue.

The plugin also adds transform-only motion with 24 px menu backdrop blur, normalizes Settings labels, and plays a 7.4-second choreographed AS cube startup intro with an immediate `Skip intro` (`Esc`) control (`window.arcPlayIntro()` replays it on demand). Reduced motion in Windows disables animations.

A build from this kit does not carry the skin. You install the plugin. See [Install](Install) and [Plugins and why the package model goes away](Plugins-and-why-the-package-model-goes-away).

The welcome window, which the build skips at startup, has the cream palette too, in case a later build brings it back.

## Checking the look

`node test/ui-crawl.mjs --lean` opens every main screen of the lean core in a headless browser. It checks for old names, blue colors and low text contrast.
It also checks that the first-run paper is `#faf9f6` and that the dark set is `#171614`. [Run the tests](Run-the-tests) has the details.
