# Page dependency trees

## `/` — application shell

- `web/src/main.jsx`
  - `MolecularWorkspace.jsx`
    - `http.js`
    - `icons.jsx`
    - HeroUI Button and Tabs
  - `BioArtWorkspace.jsx`
    - `http.js`
    - `icons.jsx`
    - HeroUI Button
  - `ResearchWorkspace.jsx`
    - `http.js`
    - HeroUI Button
  - `styles.css`

The initial workspace is Molecules. BioArt and Research share the operator token
owned by the shell. All three branches stay mounted.

## `/diagnostics`

`src/arc_science/static/diagnostics.html` is a separate static console served by
the Python application. It does not include the BioArt workspace.
