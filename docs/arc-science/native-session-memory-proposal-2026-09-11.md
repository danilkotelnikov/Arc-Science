# Native session memory: proposed Arc design

Status: researched proposal, not implemented or approved. Date: 2026-09-11.
Baseline: `847781fbb4f767cee659e2e4ca8ae9db7d920c79` (Arc 0.6).

## Decision

Recommend an Arc-owned Rust memory service with SQLite as the authoritative
record store, lexical plus vector retrieval, and one warm embedding/index worker
shared by the application's agents. Keep MemPalace import compatibility and
benchmark its native engine as a candidate. Do not adopt an entire memory stack
or promise a latency figure without Arc measurements.

This is agent-side persistent memory, not a change to model weights or a way to
put unlimited history into an LLM context window. Retrieved, bounded passages
become ordinary model input. Original text and provenance remain available.

## Current research and alternatives

The canonical [MemPalace repository](https://github.com/MemPalace/mempalace)
now advertises a `rust_exact` backend as well as its Python default. Its
[native documentation](https://github.com/MemPalace/mempalace/tree/develop/crates)
describes a Rust exact-scan engine, PyO3 adapter and standalone vector CLI.
The CLI accepts embeddings; it does not generate them. Python still handles
writes, hydration and complex filters. Its historical private-corpus speed
figures were not rerun after correctness hardening, so they are not Arc evidence.
The inspected [core source](https://github.com/MemPalace/mempalace/blob/develop/crates/mempalace-core/src/lib.rs)
loads owned float vectors from SQLite and supports collection/wing filtering.
That filtering is useful organization, not Arc authorization.

| Approach | Benefit | Tradeoff / decision |
| --- | --- | --- |
| Arc Rust service + SQLite + replaceable vector engine | Fits existing evidence contracts; small initial deployment; exact baseline before approximation | Arc owns ingestion, context integration and index consistency. Recommended. |
| Integrate MemPalace native engine | Reuses its exact scan and existing on-disk compatibility | Not a complete Rust ingestion/embedding service; requires pinned-source review and explicit import mapping. Benchmark candidate, not an automatic replacement. |
| Embedded LanceDB | Integrated vector, full-text and metadata queries with Rust support | Broader Arrow/data-engine dependency surface; test footprint and compiler compatibility before selection. Strong alternative for large multimodal collections. |

[LanceDB's Rust API](https://docs.rs/lancedb/latest/lancedb/) documents in-process
operation and persistent vector/metadata storage. For a separate derived index,
[USearch](https://github.com/unum-cloud/USearch) supports exact search, HNSW,
compact vector types and memory-mapped index views through native bindings.
USearch has a C++ core with Rust bindings; calling it a pure-Rust implementation
would be inaccurate. These are candidates, not measured winners.

## First implementation boundary

1. A small Rust library owns a separate project-local memory database. It does
   not migrate or replace `MissionRepository` or its hash-chained mission events.
2. One supervised, long-lived stdio worker serves the existing single-worker Arc
   application. Agents share that worker and its warm model/index. Native callers
   can use the library directly. No public listener, cloud service, Python
   process per query, global transcript crawl or mandatory MCP hop is introduced.
3. The first usable increment provides append, scoped search, inspect, export,
   disable, and retention operations through a versioned protocol. External MCP
   interoperability is a later adapter to the same contract, not the data store.
4. Source-backed project events are opt-in at setup. Arbitrary files, other
   projects, browser history and external session transcripts require separate
   explicit import. Start with Arc-owned session events and an explicit
   MemPalace export importer; never mutate the user's original MemPalace store.

This changes persistent-data behavior and model input. Approval of this proposal
is required before implementation under the Superpowers architectural workflow.

## Record and retrieval contracts

Each record retains project/session/agent identifiers, event sequence and role,
timestamp, original UTF-8 text, source URI or artifact digest, content digest,
trust category, visibility and retention state. Chunk records retain exact byte
spans into the original, with deterministic chunking and bounded overlap.
Summaries or extracted facts, if later enabled, are separate derived records.
They never replace the original or become verified scientific facts by retrieval.

An embedding identifies model revision, weights/tokenizer hashes, dimension,
normalization, metric and embedding-pipeline version. Reject NaN, infinity,
wrong dimensions and unusable zero vectors. Mixed embedding spaces never share
a searchable generation. A model switch builds a new generation explicitly.

Search applies authorized project/session/agent scope before candidate selection,
combines FTS5 lexical matches with semantic neighbors, and can expand a hit to its
adjacent original messages. Deterministic fusion, tie-breaking and token budgets
are versioned. A caller-supplied wing or project string is not an access grant.
Returned data includes source spans, hashes, retrieval reason and trust labels.

The context compiler records selected record IDs, exact passage hashes, query
hash, model/index generation, scope, scoring-policy version and truncation in the
mission invocation context. The existing `exploration/evidence.py` binding checks
must be extended and regression-tested before memory reaches model calls.
Replay uses frozen retrieved passages, not today's changing nearest neighbors.
Memory outage must be visible; resuming a run cannot silently alter its context.

Retrieved content is untrusted data, not system instructions. Memory cannot
change tools, permissions, network consent, evaluator thresholds or HoH roles.
Cross-agent assertions keep their author and verification state. Contradictory
or superseded facts remain distinguishable by time; memory search must support
abstention when evidence is missing.

## Storage, lifecycle and resource bounds

Use a pinned SQLite build containing the WAL-reset fix. SQLite documents the
fix in 3.51.3 and specified backports; do not assume an older bundled SQLite is
safe merely because a Rust wrapper compiles. WAL supports concurrent readers,
but still needs writer coordination, bounded busy waits and checkpointing on a
local filesystem. Do not place the live database on a network share or casually
copy the main file while it has a live WAL. Use the backup API for exports.
[SQLite WAL documentation](https://sqlite.org/wal.html).

One transaction commits the immutable event and an embedding-work item. Worker
crashes leave a resumable queue. A derived index publishes a generation only
after its file, checksum and database high-water mark are consistent. Queries
must include a bounded, exact-search tail or explicitly report indexing lag.
Deleted/hidden records are excluded using current database visibility even when
an older index still contains their vector.

Start with bounded exact search for small collections. Benchmark an optional
USearch HNSW/mapped generation for larger ones. Float16/int8 representations are
derived optimizations; retain canonical vectors when required for rebuilding and
exact reranking. Quantization and approximate recall require separate evidence.
For scale, 100,000 vectors of 384 float32 values alone require 153,600,000 bytes
(about 146.5 MiB); this excludes text, index edges, model memory and allocator
overhead. Language choice cannot eliminate that storage requirement.

Use a configurable CPU-thread budget, queue depth, document/chunk limits, cache
budget and cancellation deadline. Reuse a locally loaded encoder and batch
ingestion. [FastEmbed Rust](https://github.com/Anush008/fastembed-rs) is a candidate
local embedding adapter; its model downloads and ONNX runtime add real footprint.
Arc must require explicit model provisioning, pin assets and support offline
startup rather than silently downloading a model on a query. Compare an English
compact model and a multilingual candidate before selecting a default.

Local-only is the default. Cloud embeddings require a separate destination/data
consent decision. Do not store credentials in memory records or telemetry.
Secret screening is defense in depth, not proof that arbitrary transcripts are
safe. Disable and delete/export controls must cover source text, vectors, FTS,
generation files and caches. Tombstoning hides data immediately; physical erasure
and already-exported backups need explicit, accurately described policy.

## Acceptance before enabling by default

- Crash/restart and interrupted-ingestion tests; idempotent append; no event loss
  after an acknowledged durable write; recoverable index rebuilds and migrations.
- Cross-project and private-agent isolation, malformed vectors, duplicate IDs,
  prompt-injection records, secret-handling and deletion visibility tests.
- Stable context replay; memory cannot fabricate a citation, satisfy a Lean
  obligation, certify a figure, or relax a HoH acceptance rule.
- Real embedding tests separate from synthetic vector tests. No claim of
  semantic quality from random vectors or keyword-only fixtures.
- Compare exact versus ANN recall on 10k/100k/1m synthetic vectors; test realistic
  scoped queries and independent held-out session questions. Retrieval recall,
  answer correctness, temporal updates and abstention are different metrics.
  [LongMemEval](https://arxiv.org/abs/2410.10813) explicitly separates indexing,
  retrieval and reading, and tests multi-session/temporal reasoning and updates.
- Measure cold startup, warm p50/p95/p99, embedding time, retrieval time, complete
  context assembly, ingestion throughput, RSS, disk and binary size separately.
  Proposed initial target: retrieval-only p95 under 20 ms at 100k 384-dimensional
  records on a declared reference machine. This is a target, not a measured
  result, and does not include query embedding or LLM response generation.
- Native execution on Windows, macOS and Linux before claiming portability.
  Compile checks alone do not qualify filesystem, model-library or IPC behavior.

Implement and compare bounded alternatives against frozen evaluation data; retain
rejected candidates and independent review. The acceptance policy and access
boundaries stay fixed within each HoH run. This proposal implements no autonomous
change to those boundaries.
