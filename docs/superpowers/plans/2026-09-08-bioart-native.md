# BioArt and Native Arc Science Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provenance-preserving NIH BioArt access and a portable Rust configuration/launch application to the existing Arc Science workbench.

**Architecture:** Preserve the Python scientific worker and HeroUI interface. BioArt is a bounded provider with a project-local immutable cache; Rust owns native configuration and process lifecycle without shell sessions.

**Tech Stack:** Python 3.12, HTTPX, HTMLParser/JSON, existing vector validation, React/HeroUI, Rust 1.90.0, Cargo, TOML.

**Spec:** `docs/superpowers/specs/2026-09-08-bioart-native-design.md`

## Global Constraints

- Preserve Vedix plugin code, identifiers, installers and history.
- All collage canvases and molecular-stage backgrounds are #FFFFFF; molecular PNGs retain alpha.
- Do not execute downloaded JavaScript, AI/EPS, or untrusted SVG.
- All provider network commands require explicit `--allow-egress`; cache reads do not.
- Defaults: 8 MiB metadata, 32 MiB per file, 256 MiB cache, 24-hour metadata TTL, 30-second request timeout, at most two transient retries.
- Preserve entry-specific license/credit/citation and source/file SHA256; unknown licenses require review.
- No network/access-policy workaround, fake live retrieval, browser screenshot, proof verification or platform certification.
- Rust launches the scientific worker with direct argument vectors, never shell text or terminal sessions.
- GitHub sync is optional; never force-push, merge or change repository visibility.

### Task 1: Implement the NIH BioArt provider and usable import path

**Files:** Create focused `apps/arc-science/src/arc_science/bioart/` modules for models, parsing, client/cache and CLI. Modify `cli.py` to register `bioart` commands, and the exact existing provenance validators needed for NIH import. Add `tests/test_bioart.py`, source-derived minimal fixtures, provider configuration/documentation and a live-access status record. If adding the service/workbench surface, isolate `bioart_web.py` and `BioArtWorkspace.jsx`, with focused tests; do not weaken existing mission authentication.

**Interfaces:**
- `parse_entry(html: str, entry_id: int) -> BioArtEntry` and `parse_search(html: str) -> tuple[BioArtSearchHit, ...]`.
- `BioArtClient(cache_dir: Path, *, allow_egress: bool = False, client: httpx.Client | None = None, limits: BioArtLimits | None = None)` exposes `search(query: str)`, `inspect(entry_id: int)`, `fetch(entry_id: int, representation_id: int, format: str)` and `verify(receipt: Path)`.
- `BioArtEntry` carries entry identity, title, license, credit, creator, collection, citation and representations. Each representation binds a group ID/caption to actual format→file-ID mappings.
- `fetch` returns a typed receipt/path after an atomic verified cache write, never a browser-side arbitrary URL or arbitrary output path. Use one schema identifier `arc-bioart-asset/1` for receipts.
- CLI examples: `arc-science bioart search antibody --project ./project --allow-egress`; `arc-science bioart inspect 18 --project ./project --allow-egress`; `arc-science bioart fetch 18 --representation 64 --format svg --project ./project --allow-egress`; `arc-science bioart verify <receipt>`.

- [ ] Write RED parser tests from actual source-derived data. Assert the exact grey antibody SVG mapping, deduplication of search links, required license fields, malformed flight data and duplicate/mismatched file IDs. Test data may include this minimal record, labelled as a reduced fixture:

```python
assert entry.entry_id == 18
assert entry.license == "Public Domain"
assert next(r for r in entry.representations if r.group_id == 64).files["SVG"] == 626860
```

- [ ] Implement bounded non-executing HTML/JSON parsing. The read-only captured inputs are `/workspace/scratch/0894be2b5454/bioart-18.html`, `bioart-505.html`, and `bioart-antibody-search.html`. JSON-decode `self.__next_f.push` payload strings, then parse discovered mapping objects. Do not use eval or hardcode opaque server-action IDs. Fail with an actionable schema-drift error instead of returning a misleading empty success.
- [ ] Write RED HTTP/cache tests with injected HTTPX MockTransport: no requests without consent; cache hits make zero requests; stale/missing cache is explicit; timeout/oversize/wrong MIME/HTML masquerading as SVG; 401/403 stop without browser/alternate-host fallback; bounded 429/5xx retry; redirects rejected; missing format/group; corrupt/truncated cache; symlink/traversal rejection; unknown license requires review. Check SHA256 against independent literal bytes, not only a mock return value.
- [ ] Implement fixed-origin endpoint resolution, streamed size enforcement, bounded retries and project-local content-addressed storage. Cache mutations use exclusive temporary files and atomic promotion; verification reads only validated regular files. Returned filenames and paths must be sanitized/derived locally. All original source bytes remain immutable. AI/EPS are download-only; safe SVG/PNG inputs can become preview/import candidates under the existing validation rules.
- [ ] Add CLI behavior tests, then implement commands and NIH provenance. Update all consumers of the provenance schema together, including the standalone worker contract if it duplicates allowed origins; preserve existing BioRender behavior. Keep metadata-only availability and live vector-download status distinct.
- [ ] Add a small usable asset workspace/service surface only with complete auth, egress, loading/error, source/credit, representation/format and verified-download behavior. Do not add decorative or inactive controls. Add real HeroUI DOM tests for any new UI and build it into the wheel.
- [ ] Run focused tests during edits, the full app suite once before commit, and the frontend tests/build if touched. Do not retry live BioArt file downloads in this session: the network approval was cancelled. Document exactly what was executed and what remains unverified. Commit only task-owned paths and provide RED/GREEN evidence in the task report.

### Task 2: Implement and measure the native Rust configuration/launch application

**Files:** Create `native/arc-science/Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, focused `src/{main,lib,config,process}.rs`, CLI integration tests, native README, and `.github/workflows/arc-native.yml`. Update root README with verified native setup commands. Never edit the Vedix plugin or existing scientific calculations.

**Interfaces:** Executable `arc-science-native`; commands `init`, `config`, `doctor`, `serve`, `worker`; global `--project <directory>`. Config file `arc-science.toml`, schema version 1. Python worker invocation is `<python> -m arc_science <args...>`. Config contains `[worker] python/data/host/port` and `[bioart] cache_dir/max_metadata_bytes/max_file_bytes/max_cache_bytes/metadata_ttl_seconds/timeout_seconds/max_retries` matching Task1 defaults. No secret fields.

- [ ] Write RED config tests for exclusive initialization, strict unknown-field rejection, invalid schema/ports/limits, project-relative path resolution, spaces/unicode paths and loopback binding. Example invariant:

```rust
assert!(config.validate().is_ok());
assert!(config_with_host("0.0.0.0").validate().is_err());
assert_eq!(config.worker.port, 8080);
```

- [ ] Implement minimal Rust modules using pinned dependencies and no GUI/browser engine. Release profile uses LTO, one codegen unit and stripping. Use the installed Rust 1.90.0 toolchain via `/root/.cargo/bin/cargo`; add rustfmt/clippy through its normal rustup components if required.
- [ ] Write RED process/CLI integration tests for help, missing/invalid config, idempotence failure, worker arguments containing spaces/metacharacters, nonzero exit propagation and missing Python. Use a deterministic test worker fixture; never assert process spawning by mocking away the argument boundary. Test no shell interpolation by passing a metacharacter argument as data.
- [ ] Implement native config/doctor/serve/worker. Direct `Command` argument vectors, stable project-relative working/data paths, clear child exit/cancellation behavior, no startup network/auto-install. `doctor` reports configured/available dependencies and does not claim scientific validation. Keep the BioArt settings bridge explicit so configuration actually affects the Python provider; do not add unused options.
- [ ] Add Linux/Windows/macOS CI source build/test matrix and honest setup docs. Windows/macOS tests are configured but unexecuted in this Linux session. Tauri is a documented later desktop integration option, not a shipped GUI.
- [ ] Run `cargo fmt --check`, `cargo test --locked`, `cargo clippy --locked -- -D warnings`, and `cargo build --release --locked`. Measure binary bytes and native config/doctor command timing/peak memory with the exact environment/command/sample count recorded. Do not claim a speedup without a same-workload baseline.
- [ ] Commit task-owned paths; report commands, output, measurements and platform limits. No push.

### Task 3: Final verification and local delivery

**Files:** Research and verification Markdown under `docs/arc-science/`; source archive/git bundle and build artifacts outside the repository.

- [ ] Perform independent task reviews and a whole-branch review with the fixed accepted molecular hashes and preserved legacy behavior in scope. Carry unresolved findings forward visibly.
- [ ] Verify installed wheel asset bytes, service contracts, CLI help and native launch behavior with the real Python worker. No provider/model/Blender qualification from mocked tests.
- [ ] Save a separate primary-source research report covering NIH access/rights/interface stability, cache/fault model, Rust/Tauri tradeoffs, HoH artifact evolution, and limits of visual consensus. Distinguish recommendations from implemented behavior and unexecuted tests.
- [ ] If the GitHub connector is unavailable, do not attempt alternate authentication. Preserve a local source archive and git bundle, save them durably, and return verified file links with the exact missing qualifications.
