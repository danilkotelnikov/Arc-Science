# Shared layout

## `apps/arc-science/web/src/main.jsx`

The single-page shell has a 58 px header, a compact workspace rail, and one
content region. Molecular, BioArt, and Research remain mounted while `hidden`
selects the active workspace. This preserves forms and selections without browser
storage.

`App` owns the local operator token and passes it to BioArt and Research. The
token stays in React memory. The header reports Arc Science 0.6.0 development and
links to the separate diagnostics page.

Workspace order and icons:

1. Molecules — `atom`
2. BioArt — `scan-search`
3. Research — `search`

The desktop BioArt layout is `310px minmax(0, 1fr)`. At 1100 px the rail narrows
to 270 px. At 760 px the workspace navigation becomes horizontal and all BioArt
content stacks in document order.
