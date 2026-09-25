# S0 — Blockprint prototype, palettes, RU/EN and logo exploration: development record

Date: 25 September 2026. Plan: `C:\Users\danil\.claude\plans\replicated-cuddling-quail.md`, slice S0
(approval gate). Research basis: [research dossier](2026-09-25-research-dossier.md) (visual QA and
UI sections; brutalist UI usability and Russian UI localisation have no post-July evidence and
are labelled design judgements).
Agents: Claude Code orchestration; theme, i18n and logo-tooling editors in parallel, a
prototype editor, an independent reviewer, a fix round with a fresh capture and a second
independent visual review, then orchestrator fixes. Nothing here is a production claim.

## Objective, preserve, acceptance

- **Objective.** A clickable prototype built only from HeroUI v3 components in the approved
  Blockprint direction, with eight palettes, a live RU/EN switch, HSE Sans loaded from the
  operator's installed copy, and a wide logo exploration ending in editable vectors on an
  iOS-style continuous-corner tile, for the operator's visual approval.
- **Preserve.** The production workbench is untouched: the prototype is a separate dev-only
  entry (`web/mockup.html`, not part of the build input); package changes are limited to the
  HeroUI 3.2.6 upgrade and its React Aria peers (separate commit).
- **Acceptance.** Operator's visual approval of the default palette, the logo and the layout
  at 1280×720 and 700×800 (pending at the time of this record).

## What exists

- `web/src/theme/`: `palettes.js` (eight palettes with text tones for accent colours),
  `applyPalette.js` (HeroUI variables plus `--bp-*`), `blockprint.css` (radius 0, ink outlines,
  offsets only on primary blocks and primary actions, a leaf-only 3px focus ring, hollow
  tracks, inverted toggles, rail item style, HSE Sans through `local()` only),
  `gravity-icons.jsx` (42 Gravity UI glyphs, MIT, plus six bespoke glyphs), contrast and
  selector tests.
- `web/src/i18n/`: provider, `useT`, CLDR plurals (Russian one, few, many, other), `Intl`
  numbers, dates and relative time; `web/scripts/typograph-ru.mjs` (no-break spaces, «»
  quotes) with a CLI check; key-parity and middle-dot guard tests.
- `web/mockup.html` and `web/src/mockup/`: shell (rail, Ctrl+K, EN/RU, palette picker),
  Research cockpit tabs (overview in ruled columns, decision board lanes, claim cards with the
  validation ladder and verification density, evidence table with a trace drawer, activity,
  approvals one item at a time with blocking checks, release), Settings (seat cards and
  drawer, connectors with non-intrusive hints, "Configure with a model" checklist,
  appearance), Diagnostics, LaTeX studio layout, logo candidates sheet.
- Logo tooling: `scripts/squircle.py` (port of the figma-squircle path maths, smoothing 0.6),
  `scripts/make-icon.py --source --tile --out --sizes` (default output unchanged byte for
  byte), `scripts/vectorize-logo.py` (VTracer wrapper, development-time tool outside the repo).
- Candidates (`design/logo/`, `web/public/logo-candidates/`): Snöggo on the continuous-corner
  tile (cut-out kept verbatim), eight GPT-Image variants in its style (generated in the
  operator's ChatGPT in Zen, traced and re-seated), three geometric marks. Two BioRender
  drafts (operator's account, both saved as figures) are kept local and git-ignored until
  BioRender's licence is checked for logo use.

## Verdicts and checks

- First review: accept-with-findings, seven majors (double focus rings, offsets everywhere,
  accent contrast, toggle state, marks invisible on dark rows, header logo on dark palettes,
  Russian terms that changed meaning) and seven minors; all addressed in the fix round.
- Second review: accept-with-findings; the remaining items (LaTeX tokens on fill colours,
  clipped tab focus ring, tracks losing to HeroUI's specificity, ladder labels breaking
  mid-word, Snöggo tile on the dark row, source dates breaking, connector rows wrapping,
  picker width, disabled primary offset) were fixed by the orchestrator and checked on fresh
  1280×720 and 700×800 captures (`.omx/artifacts/s0-prototype-20260925/verify-final/`).
- Vitest 604/604; the capture pass recorded 182 screenshots with no console errors, no page
  overflow, no U+00B7, and header logo contrast at least 10.7:1.
- Open for the gate: the default palette, the logo, and whether the header pickers move into
  one menu below 900 px. Sol could not be consulted (usage limit); nothing here is scientific
  validation.
