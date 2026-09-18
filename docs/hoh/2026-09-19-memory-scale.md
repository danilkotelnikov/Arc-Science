# Memory at corpus scale — development record and evaluation, 19 September 2026

Plan: [2026-09-19-plan.md](2026-09-19-plan.md). Candidate: `native/arc-memory` engine
and tests, `apps/arc-science/tests/test_memory_scale.py`. Author: Claude (Opus 5).
Independent evaluation: Sol (GPT-5.6, read-only Codex sandbox, shared working tree —
no hard isolation; it could read and probe but not build).

## Changes

- The lexical index is now **contentless** (`fts5(text, project, session, agent,
  record_id UNINDEXED, content='', contentless_delete=1, contentless_unindexed=1)`):
  the compressed blob is the only copy of a text. Each scope value is indexed as one
  hex token, so a search narrows on the index before ranking; the final rows are
  still checked relationally (project/session/agent/visibility), so the index is a
  prefilter, never the authority. `PRAGMA user_version = 2` marks the layout; an
  older database is rebuilt once inside one transaction from its blobs (decompressed,
  size- and SHA-256-checked, row count verified, version set last).
- Lexical search ranks on the index (`rank MATCH 'bm25(1.0,0.0,0.0,0.0)'`, `ORDER BY
  rank LIMIT`) and joins record rows and blobs only for the survivors. Semantic
  search scans `(record_id, vector)` only and fetches rows for the top-k. `disable`
  also deletes the derived index row; the record and blob stay inspectable.
- Workaround: SQLite 3.53.2's `sqlite3Fts5DropAll` does not drop the `_content`
  shadow table of a `contentless_unindexed` table, so the rebuild drops
  `records_fts_content` explicitly.
- An empty scope value now abstains (the first version built `project: AND …`, an
  FTS syntax error — found by the evaluator, fixed with a RED→GREEN test).
- Kept unchanged, deliberately: one transaction per append with `synchronous=FULL`
  (the design requires no loss after an acknowledged write; retrieval tombstones are
  memory-only state), the read budgets, the protocol.

## Checks

`native/arc-memory`: 35 tests (25 engine + 10 protocol; new: migration rebuild,
exact scope tokens + disable, empty-scope abstention), clippy `-D warnings`, rustfmt.
Python memory tests 21 passed; opt-in scale tests 2 passed. Release worker under
measurement: `arc-memory-worker.exe` SHA-256 `22340776600d90de…`, built 2026-09-19
00:50 from this candidate, bundled SQLite 3.53.2.

## Measurements

Release build, this Windows 11 workstation (local NVMe temp directory, not OneDrive),
`cargo test --release --test engine measure_corpus_scale -- --ignored --nocapture`.
Corpus: 200 sessions × 100 records = 20,000 (24.4 MiB text; 70 % short event lines,
30 % 2–8 KiB JSON), 384-dim synthetic hashing embeddings (no real model). The
benchmark now asserts each budget itself.

| Measure (p50 / p95 unless noted) | Before this loop | After | Budget | Status |
| --- | --- | --- | --- | --- |
| append, mean per record | 15.4 ms | 15.35 ms | ≤ 20 ms | verified |
| idempotent replay of 100 records | 2.4 ms | 2.7 ms | — | reported |
| `session_list`, 200 sessions | 13.6 / 15.8 ms | 14.4 / 15.9 ms | p95 ≤ 50 ms | verified |
| `session_fetch`, 100 records | 4.9 / 6.0 ms | 4.7 / 5.1 ms | p95 ≤ 50 ms | verified |
| lexical, rare term (`Asp96 chain D`) | 1.9 / 2.3 ms | 4.8 / 6.2 ms | p95 ≤ 50 ms | verified |
| lexical, common term (`hydrogen`, ~8k matches) | 160.1 / 167.0 ms | 18.0 / 22.5 ms | p95 ≤ 50 ms | verified (was **failed**) |
| lexical, one session | 107.4 / 112.7 ms | 4.3 / 5.1 ms | p95 ≤ 50 ms | verified (was **failed**) |
| semantic, 20k candidates | 385.1 / 418.9 ms | 170.1 / 175.2 ms | p95 ≤ 500 ms | verified |
| hybrid | 534.4 / 606.6 ms | 197.0 / 206.1 ms | p95 ≤ lexical + semantic | verified |
| database on disk (incl. WAL) | 133.0 MiB | 105.1 MiB | reported | — |

Python (`ARC_MEMORY_SCALE=1 python -m pytest -s tests/test_memory_scale.py`, real
release worker, 100 missions × 61 records = 6,100):

| Measure | Observed | Budget | Status |
| --- | --- | --- | --- |
| first capture into an empty database | 109.6 s (18.0 ms/record) | reported | — |
| restart reconciliation (idempotent replay of 6,100 records) | 2.33 s | ≤ 30 s | verified |
| common-term search after capture | 7.3 ms | — | reported |
| worker working set after the corpus | 8.1 MiB (DB 5.9 MiB) | ≤ 200 MiB | verified |
| beyond 100 missions: startup replay | 2.48 s, then `degraded` with an actionable `last_error` | degraded, serving | verified |
| beyond 100 missions: one `/api/memory/health` read | exactly one replay, 0.11 s (in-process high-water marks skip re-sent records; only the 100 snapshots are re-appended) | ≤ one bounded replay | verified |
| beyond 100 missions: `/sessions` and `/search` while degraded | 200, 100 sessions, 5 hits | serving | verified |

What the numbers do not prove: semantic quality (synthetic embeddings), behaviour on
other disks or platforms, or the cost of a first capture of a large backlog on a slow
disk — 18 ms per record is fsync-bound (`synchronous=FULL`, one transaction per
append) and a 6,100-record backlog takes about two minutes in the background thread.
On-disk size includes a WAL that grows to the largest single transaction (the 29 MiB
embedding batch) and is not truncated; the 28 MiB saved is the removed text copy.

## Independent evaluation (Sol, GPT-5.6)

Verdict on the first frozen candidate: **reject**, with six findings. Resolution:

| Finding | Severity | Resolution |
| --- | --- | --- |
| Restart workload was 36 records/mission, plan says ~60 | medium | Corpus raised to 61 (40 events, 20 model records, 1 snapshot); re-measured: 2.33 s |
| Beyond-100 test never exercised `/health` or a live degraded service | medium | Test now mirrors the service: startup reconcile, then one health read → exactly one replay, sessions and search served while degraded |
| Benchmark printed timings without asserting budgets; no ledger artifact | medium | Budgets asserted in the benchmark (append mean, every p95, hybrid ≤ lexical + semantic, rare-query correctness); raw numbers retained above |
| Python scale test ignored `ARC_MEMORY_WORKER` and could fall back to a debug binary | medium | Uses `ARC_MEMORY_WORKER` or the release build only, skips otherwise, prints the binary's SHA-256 and build time |
| Empty scope identifiers produced an FTS syntax error (regression) | medium | Abstain on any empty scope value; RED (syntax error) → GREEN test |
| Zero bm25 weights still let the three scope tokens enter length normalization | low | Accepted and documented at the constant: no scope token scores as a term; each row carries three extra tokens in its length, uniformly. Ranking order stays deterministic |

The evaluator reproduced no scope leakage across projects or sessions and no parser
failure for queries containing `:`, `AND`, `NOT`, `*`, `^`, unbalanced quotes or a
scope hex token. It could not execute Cargo or Python in its read-only sandbox; the
author ran the re-checks listed above after the fixes. The author does not label the
resolved findings as independently accepted; the re-check evidence is the numbers and
tests recorded here.

## Gate status

The "memory scope" gate's **large-corpus session-list and candidate-scan benchmarks**
item is closed with the measurements above. Still open in that gate: a real embedder
(a new dependency, not authorized) and semantic-quality evaluation, which needs it.
