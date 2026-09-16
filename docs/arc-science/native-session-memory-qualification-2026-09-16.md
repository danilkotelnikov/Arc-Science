---
title: Native Session Memory — qualification record
date: 2026-09-16
component: native/arc-memory + arc_science.memory + HeroUI Memory workspace
status: Windows-native build qualified for the tested scope; boundaries below
---

# Native Session Memory qualification

This records what was built and executed for the native session-memory subsystem,
and — in the project's tradition — what is **not** established. Results apply to the
tested Windows machine; they are not a portability, scale, or scientific claim.

## Delivered

| Layer | Component | Evidence |
| --- | --- | --- |
| Engine | `native/arc-memory` Rust crate: bundled SQLite (≥3.51.3) content-addressed zstd store, per-session sequence, idempotent keyed append, session list/fetch/range, compaction epochs, retention tombstones, FTS5 lexical + exact-cosine semantic + RRF hybrid retrieval, generation-tagged vectors | 19 engine tests |
| Worker | `arc-memory/1` stdio protocol (length-prefixed JSON) + `arc-memory-worker` binary | 8 protocol tests incl. real-process stdio smoke |
| Python | `MemoryClient` (spawns worker), `/api/memory/*` routes, `SessionCapture` | client/routes/service/capture tests |
| Capture | decision-tree / HoH reconciliation captured from the exploration engine's `emit` | demo-mission capture test |
| UI | HeroUI **Memory** workspace (session list, lexical/semantic/hybrid search, captured-trajectory view with full provenance, retention) | 16 web tests |

## Executed checks

- **Rust:** 27 tests pass (19 engine + 8 protocol); `clippy -D warnings` clean; `rustfmt` applied. Release binary builds (`x86_64-pc-windows-msvc`, 2,719,232 bytes; sha256 `b822564739f3d57edd31f7ca1efaa197caf9ab3813e1b5935238d97ad1bd78c4`).
- **Python:** memory client/routes/service/capture tests pass; a broader run of
  `test_core/exploration/evidence_runtime/service` plus the memory suite = 55 passed,
  0 regressions (one unrelated pre-existing failure, `test_store_rechecks_hash_and_refuses_symlinks`, is a Windows `os.symlink` privilege limitation).
- **Web:** 16 tests pass, including a Memory-workspace test.
- **Feasibility:** the MSVC C toolchain compiles bundled SQLite/zstd; bundled SQLite
  is ≥3.51.3 (WAL-reset fix), independent of the host Python's 3.45.1; rustc/cargo 1.93.1.
- **Durability:** `data_survives_engine_reopen` confirms records persist across a fresh `Engine::open` (WAL commit durability).

## Live end-to-end verification

Against the running service (`ARC_MEMORY_WORKER` set), a demo mission created and
started **through the HTTP API** ran to `completed`; the worker's `emit` auto-captured
its trajectory into memory — **18 records across epochs 0–2** — and the HeroUI Memory
workspace rendered the planner / analyst / falsifier decision tree with per-record
provenance (`trust`, `mission://…` source, content digest) and retention controls.
Search by branch meaning (e.g. "quadratic") returned the relevant round's reasoning.

## Measured retrieval latency

Release build, one reference Windows machine, `n = 5000` records, 384-dim synthetic
embeddings, 100 queries each (worst-case broad queries):

| Retrieval | p50 | p95 |
| --- | --- | --- |
| lexical (FTS5) | 15.8 ms | 19.1 ms |
| semantic (exact cosine) | 88.2 ms | 94.0 ms |
| hybrid (RRF) | 106.1 ms | 113.3 ms |

These are **measurements, not the design target**. The exact cosine scan is O(n); it
serves small session collections well but will not meet the proposal's "p95 < 20 ms at
100k × 384-dim" target at scale. That target requires the approximate index (USearch
HNSW) the design defers — the exact baseline exists precisely so an approximation can be
compared against it before adoption. A measurement of this baseline also drove a fix:
`semantic_search` now scores on vectors and decompresses only the top-k (semantic p50
fell from ~478 ms to ~88 ms).

## Boundaries — what is NOT established

- **No approximate index yet.** Exact scan only; USearch/LanceDB remain benchmark candidates.
- **Live retrieval is lexical-only.** The running worker has no embedder configured, so
  semantic/hybrid over the API report "no embedder configured". The real local ONNX
  embedder is deferred to explicit provisioning (no silent download); semantic tests use
  a deterministic synthetic embedder and never claim semantic quality from it.
- **No memory→model feedback.** Capture is one-directional (missions → memory). Memory
  does not yet feed the planner's context, so the replay-binding work (freezing retrieved
  passages into the capsule) has nothing to bind yet; retrieval-augmented planning +
  replay binding are the next forward increment.
- **Capture is best-effort.** A capture failure is swallowed so it can never fail a
  mission; a stricter, *visible* memory-outage signal is future work.
- **Windows-native only.** macOS/Linux native runs and a live NIH-style external-import
  path (MemPalace, transcripts) are not run here.
- Content hashes detect corruption relative to their own records; they are not external
  signatures, and retrieval is never scientific validation. Retrieved passages are
  untrusted data; memory grants no authority over tools, permissions or acceptance.

## Next gates

1. Provision a pinned local embedding model; enable live semantic/hybrid; requalify latency.
2. Add and benchmark an approximate vector generation (USearch) against the exact baseline.
3. Retrieval-augmented planning + replay binding (frozen retrieved passages in the capsule).
4. macOS/Linux native execution; external-transcript import as an opt-in adapter.
