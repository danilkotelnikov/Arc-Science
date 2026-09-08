# Historical evidence and companion files

The application was imported from the preserved rendering checkpoint. Its versioned 0.3/0.4 research and qualification reports describe earlier runs, not fresh execution of the current branch.

`Arc_Science_Rendering_Working.zip`, already saved with the project, contains these historical paths under its `arc-science/` directory:

- `evidence-v0.3/verification.json` and `evidence-v0.3/reviews/`
- `evidence-v0.4/verification.json` and `evidence-v0.4/reviews/`
- `docs/intermediates/Arc_Science_Rendering_Checkpoint.json`

The development source import intentionally excludes the full historical evidence trees, publisher reference pixels, large native scenes and local environments. Relative historical links in the imported reports resolve inside that companion checkpoint, not inside this lean source tree.

`Arc_Science_0.5.0_Molecular_Figure.zip` is the separate editable molecular companion, including native scene files. The smaller, immutable 1DQJ subset served by the app lives at `apps/arc-science/src/arc_science/example_assets/1dqj/`; its public manifest enumerates only the files actually shipped there.

Companion identities checked on 8 September 2026:

| File | SHA256 |
|---|---|
| Arc_Science_Rendering_Working.zip | `5fb4c99ada7837eadcf4644f98155e67a2c0319c79c4d5d224397add0e25ae8c` |
| Arc_Science_0.5.0_Molecular_Figure.zip | `d1d830d9b8e39319b560aa8c07c2510ae878515d0a55661a8bf4a61b5f2b9e91` |

Current implementation and review results belong to this development branch's verification record. Earlier native rendering does not establish a fresh render, a new visual-provider call, or Windows/macOS validation of the current application.
