# Arc Science design system

## Product and task

Arc Science is an evidence-bound scientific workbench. The primary surfaces are molecular figure inspection, research mission reconciliation, and a BioArt asset workflow that must keep rights, provenance, verification, and scientific limitations visible. The user should be able to search NIH BioArt, inspect an entry, deliberately permit network access, fetch the compatible neutral SVG, verify its receipt, and import it into the current project without losing the evidence trail.

## Visual direction

- Use a total-white figure and content canvas. The only alternate surface is the very light navigation grey `#f8f9fa`.
- Use restraint: no gradients, glass effects, decorative illustrations, floating ornaments, saturated color fields, or ornamental shadows.
- Use color only for scientific role, selection, trust state, or error state.
- Primary accent is `#315d7c`; selected controls use `#eaf0f4`. Antibody blue is `#91aec5`; neutral scientific grey is `#c4c9cc`.
- Use Inter/system sans-serif. Maintain the existing compact type hierarchy: 20 px page headings, 13–14 px section headings, and 10–12 px labels and metadata.
- Use thin neutral rules to structure dense evidence. Radius is 4–5 px. Keep generous white space around figures but compact controls and metadata.
- Use HeroUI 3 buttons and tabs. Native form controls follow the existing five-pixel radius and one-pixel neutral border.
- Use one coherent Lucide outline icon family. Icons clarify actions; they do not decorate headings.

## Layout behavior

- Preserve the fixed 58 px header and compact left workspace navigation.
- Desktop BioArt view: a 300–340 px query/results rail, a flexible white inspection stage, and a compact evidence panel or evidence section that does not obscure the selected asset.
- Mobile: workspace navigation becomes horizontal; panels stack; actions remain reachable by keyboard and touch.
- Keep Molecular, BioArt, and Research workspaces mounted so tokens, queries, selections, and unsaved forms survive workspace switches. Do not persist operator tokens to browser storage.

## BioArt state model

- Empty: explain the source and that live access requires explicit consent.
- Search: show the query, result identity, and source link; do not fabricate thumbnails.
- Inspect: show entry ID, title, creator, collection, license, credit, citation, and all representations with available formats.
- Fetch: require a visible `Permit NIH network access for this request` control. Default to compatible neutral-labelled SVG selection, but retain a representation override.
- Verified: show the exact receipt digest, source file hash, format, file ID, source-page hash, preview/import eligibility, and limitations.
- Imported: show the immutable Arc asset ID and manifest path. State that rights metadata and file validation do not establish scientific correctness.
- Errors: keep the previous valid selection and render a specific, actionable message. Unsupported metadata schema, restricted license, unsafe SVG, missing cache, timeout, and authentication failures must remain distinct.

## Content rules

- Use precise labels such as `Public Domain metadata`, `Receipt verified`, and `Scientific validity not established`.
- Never label public availability as reuse permission. Never label a successful download as a scientifically valid figure.
- Keep source URLs, attribution, hashes, and limitations close to the asset they govern.
- Prefer neutral SVG representations to reduce recoloring work and keep figure palettes coherent.

## Motion and accessibility

- No ambient animation. Loading state may use text and disabled controls.
- Maintain semantic landmarks, native labels, `role="alert"` for failures, and `role="status"` for progress.
- Every action must be keyboard operable. Visible focus uses a 2 px `#315d7c` outline.
- Do not rely on color alone for license, verification, or eligibility state.
