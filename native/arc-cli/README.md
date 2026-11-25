# Arc CLI

`arc-cli` builds the standalone `arc` binary with zero external crate dependencies.

## Commands

- `arc version`: Prints the version, host platform, and zero-DSH status as JSON.
- `arc targets`: Prints the five precompiled Windows, ARM, and Linux distribution targets as JSON.
- `arc check-sha256 <text>`: Prints the SHA-256 hex digest of the input text.
- `arc check-prose <file>`: Runs the Arc prose rules against a file.
- `arc selftest`: Runs SHA-256, HoH gate, Change Tree, taint, VOI, and target-matrix checks.

## Limits

This binary covers local deterministic checks and target metadata. Interactive session hosting and remote provider calls belong to later slices.
