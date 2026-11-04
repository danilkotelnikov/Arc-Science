# Arc Theme

Gives the interface the Arc Harness paper look, with cream surfaces, a brown primary button, Geist type and rounded corners.

## Purpose

Arc Theme restyles the web interface in the Arc Harness paper look. It follows the system light or dark mode.

## Policy

- The light theme uses cream paper, white cards and ink text.
- Primary buttons are dark brown on paper. The dark theme uses warm near-black surfaces.
- Cards use 10 pixel corners and controls use 8 pixel corners.
- Text uses Geist and code uses Geist Mono. Both fonts ship inside the plugin under the SIL Open Font License.
- No blue is left. Links, buttons, code colors and icons use greys and browns.
- A stylesheet check rewrites every blue color in every rule to a grey of the same lightness. It covers hover, focus, gradients, shadows, keyframes and icons in data addresses.
- A picture check draws any picture or inline-styled element that is still blue in grey. It re-checks marks, so a dot that turns green loses its mark.
- A delimiter check replaces the middle dot and bullets that separate items in interface text with commas. After a number, it writes a period.
- Chat messages, code and formulas keep their text.

## Workflow

1. Install or enable the plugin.
2. Open Arc Harness.
3. The page applies the theme at once.
4. The theme follows the system light or dark mode.

## Settings

- The theme has no setting.
- Geist and Geist Mono are embedded, so no font install is needed.

## Data it reads and writes

- Reads the stylesheet rules and the elements of the open page.
- Writes a style element and a theme attribute on the root element of the page.
- Writes no local-storage entry.
- Makes no network calls.

## Failure behavior

- When the plugin unloads, it removes the theme attribute and the style element.
- When an embedded font fails to load, the system font shows.

## How to verify

1. Open the Plugins page and find Arc Theme.
2. Check that the page is cream in light mode and warm near-black in dark mode.
3. Check that no blue remains, in light and in dark mode.
4. Check that cards have rounded corners and that the text is Geist.
5. In the plugin source folder, run node test/theme.test.mjs and check that every test passes.
