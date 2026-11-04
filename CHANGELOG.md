# Changelog

All notable changes to Arc Harness are listed here. The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). The build kit is at 0.1.0, and each plugin has its own version in its `package.json`.

## [Unreleased]

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
- The upstream project is credited once, in the README. `NOTICE.md` keeps the licence text.
- The repository history starts at the Arc Harness build kit. The retired Arc Science desktop app is no longer in this repository.

## Build kit, first public state (2026-11-03)

### Added

- Build patches 1 to 15: brand, no vendor connections, cream look, Thinking label, lean core, no coding view row.
- Install and rollback, lean profile tool, and the checks: build check, screen crawl in three phases, word scans, network trace, positive control.
- `plugins/dsh-hoh` 0.3.0: propose, freeze and accept gate with a hash-chained ledger, and a Trace tab in the right sidebar.
- `plugins/dsh-theme-pair` 0.4.0: the cream and warm dark skin with Geist.
