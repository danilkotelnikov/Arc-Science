# Changelog

All notable changes to Arc Harness are listed here. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). The build kit is at 0.1.0, and each plugin has its own version in its `package.json`.

## [Unreleased]

### Added

- Pull request automation: `@claude` in a pull request comment asks for an edit or a fix, and `pr-screen` reviews each pull request from this repository. Haiku screens, Sonnet fixes critical findings for at most three rounds, and Argon reviews first when it is turned on. Nothing merges by itself.

### Removed

- The "What the build changes" table is gone from the README.

## [0.1.0] - 2026-11-05

### Added

- Clean room: every internal name moves to Arc. Packages are `@arc-harness/arc-*`, the runtime folder is `arc/`, and the data folder is `~/.arc` with the variable `ARC_HOME`.
- Workflow clips and the intro film in `media/`.
- The first install copies the old data folder to `~/.arc` with Arc names, and leaves the old folder as it was.
- Changelog, citation file, wiki pages, `npm test` scripts, editor settings and Dependabot updates for GitHub Actions.
- A wiki page on how the system works, a road map with a picture, a request-flow schematic and new screens from the running app.
- A desktop journey test with real clicks: `test/desktop-journey.mjs`, modes `settings`, `reply`, `retry` and `shots`.

### Changed

- Settings shows the read-only Built-in plugins section again. The plugin manager stays off.
- Running labels shine from one gradient on the text. The original sliding second copy looked torn.
- The plugins are renamed: `dsh-hoh` is now `arc-hoh`, and `dsh-theme-pair` is now `arc-theme`.
- GitHub Actions are pinned to full commit SHAs.
- The lean profile tool refuses to list a plugin that is not installed, and a refused apply changes nothing.
- The README opens with an animated header that plays once, with a still copy for readers who turn animation off. The tile and name sit on a dark band with a cream edge, so the band shows on every GitHub theme.
- The slogan is now "Predict the future with the flow of your thoughts". It is page text under the header, and `docs/images/social-preview.png` carries it too.
- The session screenshot moved from the top of the README to Screens.
- The README shows a real task: the gate refusals, the shared memory answer, the permission card, and a table of what runs in the app today.
- `test/header.test.mjs` guards the header files. Arc Harness wrote it in that task, an independent read added more checks, and `npm test` runs it.
- `test/desktop-journey.mjs` has a `task` mode. It never answers a permission prompt.
- The upstream project is credited once, in the README. `NOTICE.md` keeps the licence text.
- The repository history starts at the Arc Harness build kit. The retired Arc Science desktop app is no longer in this repository.

### Fixed

- The Harness of Harness ledger stays in use across the upgrade: `arc-hoh` keeps a ledger in the original data folder until `~/.arc` has its own, and it honours `DSH_HOME`.
- `DSH_HOH_RETAIN=0` and `DSH_HOH_BRIEF=0` count as opt-outs again.
- The lean profile keeps one undo list per data home, so restoring one home cannot write the list of another.
- A `~/.arc` that holds only the ledger no longer hides the profiles in `~/.dsh`.
- The data-home copy stops when two names map to one target, and private folders and files stay private.
- The first install copies the data before it replaces the app, and a failed copy leaves nothing behind.
- A text file that is not UTF-8 keeps its bytes in the data copy.
- The runtime rollback list is saved before each change.
- A data copy cannot go inside its own source, and a file that cannot be linked is copied.
- CI runs the build kit tests and the test home self-test.

## Build kit, first public state (2026-11-03)

### Added

- Build patches 1 to 15: brand, no vendor connections, cream look, Thinking label, lean core, no coding view row.
- Install and rollback, lean profile tool, and the checks: build check, screen crawl in three phases, word scans, network trace, positive control.
- `plugins/dsh-hoh` 0.3.0: propose, freeze and accept gate with a hash-chained ledger, and a Trace tab in the right sidebar.
- `plugins/dsh-theme-pair` 0.4.0: the cream and warm dark skin with Geist.
