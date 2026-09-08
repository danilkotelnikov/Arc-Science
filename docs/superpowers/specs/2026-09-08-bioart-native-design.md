# NIH BioArt access and native Arc Science foundation

This increment follows the user's explicit instruction to continue development locally if GitHub sync is unavailable. Preserve the reviewed Arc application, its HoH boundaries, and the existing Vedix plugin. Add a usable NIH BioArt provider and a small Rust application that configures and launches the existing scientific worker. A complete Rust rewrite and signed desktop installers are outside this increment; neither performance improvements nor cross-platform certification may be asserted without measurements.

## Architecture choice

Keep Python for the existing scientific, model-provider and Blender code, HeroUI for the interface, and put configuration and process launch into Rust. This preserves validated behavior while establishing a native application boundary. A full rewrite would require independent scientific-equivalence testing; an Electron wrapper would introduce a bundled browser without moving the scientific workload. Tauri 2 is the preferred later desktop-window layer because it accepts the existing web frontend and uses the system webview. The first deliverable is a tested Rust CLI, not a pretend desktop installer.

## BioArt provider

The canonical origin is `https://bioart.niaid.nih.gov`. Verified public routes are `/discover?q=antibody&sort=relevance`, `/bioart/18`, and file references shaped `/api/bioarts/18/files/626859`. The public HTML includes JSON-encoded Next flight records with `carouselItems` and `filemapping`. Parse these as data with JSON decoding; never execute downloaded JavaScript. These are observed website interfaces, not a documented stable public API.

Verified entry 18 is Antibody, NIAID Visual & Medical Arts, creator Ryan Kissinger, credit Courtesy of NIAID, Public Domain, submitted 2024-10-07, modified 2025-01-30. Its grey representation has group 64: AI 626856, EPS 626857, PNG 626859, SVG 626860. Entry 505 is Syringe, same collection/creator/credit, Public Domain; group 1943 maps AI 636180, EPS 636181, PNG 636183, SVG 636184. The antibody search returned seven entries on 2026-09-08. Preserve these facts as source-derived test evidence; do not invent successful file downloads.

Search and inspect should work through an on-demand bounded HTTP client, with cache-only operation available without egress. Do not mirror the whole catalog. Resolve only file IDs found in the selected entry's own representation map. Prefer a neutral representation when one is explicitly labelled grey or black-and-white; otherwise retain the original and report its colour. Preserve SVG/AI/EPS originals as downloadable source assets; never execute AI/EPS or inline untrusted SVG. Validate PNG decoding and SVG safety before an asset is eligible for preview/import. Unsupported SVG constructs must remain a clear import limitation, not trigger a permissive converter.

Every successful fetch records entry URL, title, collection, creator, credit, license text, citation, representation, file format/ID, retrieval timestamp, source-page hash and file SHA256/size. Record unknown licenses and require operator review; do not turn all NIH material into Public Domain. Use a project-local content-addressed cache with atomic writes, regular-file/symlink checks and independent hash verification on reuse. Defaults: 8 MiB metadata response limit, 32 MiB per file, 256 MiB cache budget, 24-hour metadata TTL, 30-second request timeout, and at most two transient retries. Stop on 401/403 and policy failures; honour bounded Retry-After on 429. Do not redirect to arbitrary hosts, log credentials or make hidden network requests.

Expose CLI search, inspect, fetch and cache verification, and connect safely to the existing immutable vector import contract with a distinct NIH BioArt provenance origin. All network commands require explicit `--allow-egress`; cache reads do not. Add an authenticated service interface with explicit egress input and a small HeroUI asset workspace if it can be completed and tested in this increment. Browser assistance is an optional explicit user action, only for a public page whose data requires JavaScript; it must never follow an access denial. Do not fabricate a successful Playwright fallback or bypass the existing browser security constraints.

Direct vector transfer in this session stopped because network approval was cancelled before a decision. No further attempt against those files, browser extraction or alternate-host workaround is authorized. Local provider development and offline transport tests can proceed; live vector retrieval remains unverified. The successfully retrieved public HTML is available as read-only research input in scratch.

## Native application

Create `native/arc-science/` with a pinned Rust toolchain, Cargo lockfile, small focused modules and a native `arc-science-native` executable. Provide `init`, `config`, `doctor`, `serve` and `worker` commands with `--project` and useful help. A project-local TOML configuration contains schema version, Python executable, data directory, loopback host/port, and the BioArt cache settings above. No credential values belong in it. Initialization is exclusive and never overwrites an existing configuration. Reject unknown fields, invalid limits, non-loopback default binding and unsupported schema versions.

`serve` invokes the configured Python executable directly with argument vectors, not a shell or terminal session; it runs `-m arc_science serve` with the configured data directory/host/port. `worker` passes explicitly supplied arguments to the same module without concatenating shell text. `doctor` validates configuration and reports local dependency availability without claiming missing Blender/Lean/provider execution. No unrequested install, background auto-update or network request occurs at startup. Handle child exit status, cancellation and missing executables clearly. Relative project paths resolve against the project, not the caller's working directory.

The native library must be portable across Windows, Linux and macOS. Add CI matrix source builds/tests for all three and development build instructions. Execute Linux tests/build here; report Windows/macOS CI as configured, not run. Measure the release binary size and native configuration-command time/peak memory if supported. Do not compare the Rust supervisor with the entire Python scientific workload as if they did the same work.

## Preserved scientific and visual boundaries

All collage/stage backgrounds remain #FFFFFF. The accepted RCSB1DQJ collage and its hashes remain immutable. Muted antibody blue and antigen grey remain defaults. NIH vectors are schematics and never replace coordinate-derived structures or measured plots. Retain exact numeric data, units, uncertainty and full contact tables.

HoH retains fixed role/runtime/acceptance contracts within a run. Candidate exploration has bounded calls/time, frozen evidence, independent evaluation and explicit failed/uncertain outcomes. Research consensus is not proof. Lean-backed mathematical qualification and full self-modifying-harness promotion remain explicitly unqualified until their actual verifier/evaluator runs exist.

## Evidence and delivery

Use TDD for new contracts, offline fault-injection tests and the existing regressions. Save research, receipts, measurements and review records in the project. Do not modify existing skill files, publish private screenshots, or include third-party reference pixels without authorization. GitHub sync is optional under the user's latest instruction. If unavailable, deliver a source/development archive plus a local git history/bundle and build outputs, clearly labelled with limitations.
