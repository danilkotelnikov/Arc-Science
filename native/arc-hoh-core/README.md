# Arc HoH Core

`arc-hoh-core` is a zero-dependency Rust library for Harness-of-Harness verification.

## Modules

- `ledger`: SHA-256 candidate digests, hash-chained ledger verification, and the pure accept gate.
- `change_tree`: Finite-state Change Tree decision engine with exhaustive verification of properties P1 through P10 across all 524,288 states.
- `decision`: Taint lattice join, Bayes value-of-information routing, cross-family builder and checker pairing, and exit-guard evaluation.

## Limits

This crate provides pure deterministic evaluators and performs no network or filesystem I/O.
