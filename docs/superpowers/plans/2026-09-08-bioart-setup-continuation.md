# BioArt and native setup continuation

> **For agentic workers:** use Superpowers subagent-driven-development, test-driven-development and verification-before-completion. This continues the already accepted BioArt/native architecture, not a complete Rust rewrite.

Spec: `docs/superpowers/specs/2026-09-08-bioart-native-design.md`.
Baseline: `660ef2b7bae6325caae6e1417331ab6a3c278957`.
Goal: remove manual representation-ID and interpreter-configuration friction while preserving the provider's existing integrity boundaries.

## Global Constraints

- Preserve the existing Vedix plugin, original history, HeroUI implementation and frozen 1DQJ image/source bytes. Pure-white figures and restrained coloring remain unchanged.
- No live NIH vector transfer, alternate-host download, browser workaround, authentication workaround, catalog mirroring or dependency installation. Existing denied operations remain stopped.
- BioArt remains an observed website interface, not a stable public API. Fetch/import automation remains restricted to exact `Public Domain` metadata, with entry-bound file IDs, immutable original bytes, hashes, receipts, configured limits, and explicit `--allow-egress`.
- No recoloring, permissive SVG conversion, shell command concatenation or implicit network authorization. AI/EPS remain download-only, PNG preview-only.
- Native configuration is portable source code; only Linux execution is qualified here. The Python BioArt cache/import remains POSIX-only. I1 repeated-native-cancellation containment remains open; this increment must not weaken or misrepresent that limit.
- Fixed HoH role/runtime/evaluator contracts, one implementation writer, independent review and preserved failed evidence. No claims that consensus, matching images or tests establish general scientific validity.
- Use `apply_patch` for edits. No agents may spawn subagents. Preserve all review intermediates in the project as the user requested.

## Task 1: Make existing BioArt fetch defaults usable

Files: `apps/arc-science/src/arc_science/bioart/models.py`, `client.py`, `cli.py`; focused new tests `apps/arc-science/tests/test_bioart_selection.py`; documentation `apps/arc-science/docs/bioart.md`.

1. Write failing tests before production changes. Exercise real selection, client cache and CLI paths with clearly synthetic local file bytes; never live network.
2. Make `BioArtClient.fetch(entry_id, representation_id=None, format='SVG')` backward-compatible with existing explicit calls. Validate the format/identity before any metadata request. A supplied representation ID remains authoritative and rejects a missing format; never substitute another representation.
3. When no representation is supplied, filter to representations containing the requested format, then prefer an explicitly labelled neutral caption (`grey`, `gray`, `greyscale`, `grayscale`, or `black-and-white`/`black and white`/`blackwhite`, matched as words, case-insensitive). Otherwise select the first compatible representation in source order. No compatible representation means an actionable error, never an implicit PNG or format substitution. Stable ties use source order. Keep the existing inspect preference property compatible; share neutral matching logic where appropriate.
4. `bioart fetch ENTRY_ID` defaults to SVG and optional `--representation`; preserve manual `--format` and `--representation`. Retain the selected group/file IDs and caption in the actual verified receipt. Do not add inferred visual quality or scientific-validity fields. A selected neutral caption is metadata, not a pixel-analysis claim.
5. Tests cover: default SVG; neutral priority; a grey representation without SVG; no compatible format; explicit colored override; invalid explicit group; neutral-like substrings not matching; stable ties; restricted license; no hidden egress; second cached fetch makes no additional requests; legacy explicit interface. Confirm the real CLI can fetch from a cache seeded by synthetic transport and returns the expected literal group/file IDs and source hash.
6. Run focused tests while iterating, then the BioArt selection/provider/deadline suite once before commit. Record exact RED and GREEN commands/output and commit only task files. Update provider examples/limitations without claiming live download qualification.

## Task 2: Native setup and first-class BioArt commands

Files: `native/arc-science/src/config.rs`, `main.rs`, focused new `bioart.rs` if necessary plus module export, `tests/config_cli.rs`, focused native BioArt CLI tests; application integration test; `native/arc-science/README.md`; `.github/workflows/arc-native.yml`.

1. Write failing tests first. Default Python executable is `python` on Windows and `python3` on Unix. Add `init --python PATH` so a selected venv interpreter can be persisted without editing TOML. It denotes one executable, never shell text; spaces/Unicode are valid. Validate before creating the exclusive config. Blank/NUL/invalid relative path values must not leave a configuration file. Do not execute, install or canonicalize a venv executable during init.
2. Add native `bioart` subcommands matching the existing Python interface: `search`, `inspect`, `fetch`, `verify`, `import`. Use typed Clap parsing and build an argument vector to the existing `process::run`; no duplicated transport/provider logic. `fetch` takes an entry ID and defaults to SVG, with optional representation/format overrides. Search supports the existing explicit offline `--search-html`, never automatic browser launch. Forward the resolved native project exactly once so config/cache and Python project cannot diverge. Egress is opt-in only for search/inspect/fetch, never verify/import. Command-specific help requires neither a project config nor Python.
3. On Windows, direct native BioArt operations must fail before worker launch with the clear POSIX cache/import limitation. Native init/config/doctor and generic worker source support remain available. Do not relabel this as Windows BioArt support. Preserve lifecycle and I1 warnings unchanged.
4. Native tests use real stdlib worker fixtures to assert exact argv/cwd and settings; test values containing spaces/Unicode and shell metacharacters as data, both format/representation choices, offline search, absent egress, restricted verify/import flags, malformed CLI values, init exclusivity and Windows-specific default/rejection under cfg gates. Do not use Windows binary execution claims from Linux cfg inspection.
5. Add one real native-to-application offline integration test using source-derived entry metadata and explicitly synthetic SVG cache bytes. Invoke native `init --python` then `bioart fetch 18`, check literal entry/group/file IDs, default SVG, and hash/receipt verification. A nondefault configured cache proves the bridge. Explicitly skip only when native debug binary is missing, and make the existing Linux CI job build/check it and run this test. Existing platform matrix remains native/stdlib only.
6. Run covering tests, all native tests, format and Clippy checks and release build. Update Linux/macOS shell and Windows PowerShell setup examples: no global pip/system installs or automatic package downloads. Document exact supported capabilities, not signed installers or a full Rust scientific engine. Record tests and commit task files.

## Controller research, verification and handoff

Refresh NIH primary guidance and platform references; use the named research integrations for targeted discovery/raw-paper evidence. Reuse the accepted Superdesign/HeroUI direction; do not repeat a stopped Superdesign authentication flow. Jinkō routing must not create an unrelated model/trial. Check icon recommendations for semantic fit before accepting them. Preserve these distinctions in a separate research addendum.

After the per-task gates, obtain one whole-continuation-branch review. Run fresh Linux regressions, native release and actual installed-wheel offline integration. Preserve original figure hashes and document unexecuted Windows/macOS CI, I1, live-vector and GitHub-write limits. Save a development archive, full-history git bundle, research and verification in the user's project. Do not claim the inherited root suite is green; its previous failures remain documented.
