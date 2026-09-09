# Extractable components

## AppShell

- Source: `apps/arc-science/web/src/main.jsx`
- Category: layout
- Responsibility: header, workspace navigation, active-workspace state, and the
  shared in-memory operator token.

## BioArt evidence panel

- Source: `apps/arc-science/web/src/BioArtWorkspace.jsx`
- Category: compound
- Responsibility: render an inspected entry, representation/format controls,
  immutable receipt metadata, preview, download, and import state.
- Candidate props: entry, receipt, selected format, selected representation,
  action handlers, and busy/error state.

## ProtectedPreview

- Source: `apps/arc-science/web/src/BioArtWorkspace.jsx`
- Category: data display
- Responsibility: authenticated blob fetch with abort and URL revocation.
- Current props: receipt and request.

## Icon

- Source: `apps/arc-science/web/src/icons.jsx`
- Category: basic
- Current prop: `name`.
- Fixed geometry: 24 px viewBox, 16 px rendered size, 2 px rounded outline.

HeroUI Button and Tabs remain external primitives.
