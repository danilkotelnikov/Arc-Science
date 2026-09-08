# Rulings I made

These decisions are retained in the same order as the migration and BioArt/native ledgers. They explain the scope choices and their costs; they are not hidden configuration changes.

## Repository and interface migration

1. Use a fresh clone and named development branch, without an additional linked worktree. The original local project and remote master remain untouched. Cost if this layout is unsuitable: another branch/worktree migration.
2. Preserve `plugins/vedix` and its identifiers, importing Arc under `apps/arc-science`. This protects existing plugin compatibility. Cost: transitional Vedix naming remains in the repository.
3. Target a development branch and draft pull request, with no merge. The user requested development submission, not a master-branch merge. Cost: a later acceptance step is required. No remote submission succeeded because access remained unavailable.
4. Treat repository-slug rename as a separate unavailable operation. The connector exposed no rename action and its credentials were not repurposed. Cost: the remote URL can remain `vedix` although the product is Arc Science.
5. Keep publisher/user reference pixels and large editable Blender scenes out of public source. Retain public exports, coordinates, worker and the separate editable companion. Cost: native scene editing requires that companion or regeneration.
6. Deliver a bounded application/UI integration increment. Broad harness evolution, Lean execution and composite-diagram editing remain tracked requirements. Cost: further development is needed for the full product vision.

## BioArt and native foundation

7. Continue without GitHub sync under the user's explicit fallback authorization. Cost: external submission remains pending; the local source and history archives are the handoff.
8. Put configuration and process supervision in Rust while preserving the Python scientific worker and HeroUI. This avoids claiming scientific equivalence for an untested rewrite. Cost: Python dependencies remain, and a full rewrite or desktop package is later work.
9. Fetch NIH metadata and selected entry-bound assets on demand, preserving originals and provenance. Do not mirror the full catalog or assume one license. Cost: an observed website schema can change and must fail visibly.
10. Stop live vector-transfer attempts after network approval was cancelled. No browser, alternate-host or extraction workaround was used. Cost: real NIH SVG retrieval and rendering remain unqualified; only offline adapter behavior is tested.
11. Retain intermediates and review ledgers as the user requested. Cost: a larger development archive, with the review history recoverable.
12. Stop the Superdesign authentication flow after its login timed out. No generated draft is claimed. Cost: the implemented HeroUI workbench is not a Superdesign-generated design.
13. Isolate owned HTTP transport in a killable child and cancel the native worker tree. Python signals cannot bound every native DNS resolver. Cost: process-launch overhead and a portable process-lifecycle dependency; injected custom transports retain a separate trusted boundary.
14. Make native supervision noninteractive, with null standard input and inherited output. Process-group isolation should not leave a reader stopped on terminal input. Cost: interactive credential prompts require a separate operator terminal workflow; no PTY or terminal handoff is provided.
