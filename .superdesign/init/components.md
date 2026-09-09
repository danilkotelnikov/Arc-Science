# Shared UI components

Arc Science uses HeroUI 3 buttons and tabs directly. Native inputs, selects,
checkboxes, details, and semantic landmarks use the shared stylesheet.

## Local components

- `MolecularWorkspace.jsx` displays the frozen 1DQJ figure, view tabs, zoom, and
  exact artifact downloads.
- `BioArtWorkspace.jsx` owns cache-first search, evidence inspection, source
  selection, verified preview/download, and eligible SVG import.
- `ProtectedPreview` is local to `BioArtWorkspace.jsx`; it fetches the protected
  preview with the operator token, uses a revocable blob URL, and reports loading
  or failure without exposing the token in the URL.
- `ResearchWorkspace.jsx` operates missions, artifacts, review, and replay.
- `icons.jsx` renders a 16 px Lucide outline family obtained through Supericons:
  atom, search, scan-search, cloud-download, import, shield-check, and download.

The repository notice records Lucide attribution. There are no decorative icon
families or local replacements for HeroUI controls.
