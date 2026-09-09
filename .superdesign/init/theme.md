# Theme

## Tokens and rules

- Canvas: pure white `#fff`; navigation surface `#f8f9fa`.
- Text: `#28323b`; muted text ranges from `#78828a` to `#92989d`.
- Accent: restrained scientific blue `#315d7c`; selected surface `#eaf0f4`.
- Molecular roles: antibody `#91aec5`; antigen `#c4c9cc`.
- Rules: `#dce0e3`, `#e4e7e9`, `#e9ebed`, and `#edf0f2`.
- Error: `#a23d3d`.
- Typeface: Inter with system sans-serif fallbacks. Body is 13 px, labels are
  10–11 px, and the main heading is 20 px.
- Radius: 4–5 px. No gradients, decorative shadows, glass effects, ambient
  animation, or saturated status fields.
- Breakpoints: 1100 px and 760 px.
- Focus: a visible 2 px `#315d7c` outline; state is never communicated by color
  alone.

`apps/arc-science/web/src/styles.css` is the canonical source. BioArt uses a
310 px search rail and a flexible white evidence stage. Source metadata and file
controls form two columns; the verified preview and receipt metadata form a second
two-column block. Both stack below 760 px. Thin rules, small status chips, and
compact type carry hierarchy without adding background panels.
