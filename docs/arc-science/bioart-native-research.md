# NIH BioArt access and a native Arc Science foundation

Research date: 8 September 2026. This report separates public-source findings, observations from this session, and engineering decisions. It is not a claim of publication-grade validation or a completed Rust rewrite.

## Decision

Use NIH BioArt as an on-demand source of attributed, immutable schematic assets. Keep coordinate-derived molecular renders and measured plots separate from those schematics. Add a small Rust configuration and process supervisor around the existing Python worker and HeroUI interface. Preserve the scientific code until an alternative implementation passes equivalence tests.

The public metadata is accessible. A direct vector transfer stopped at a network-approval boundary before any vector bytes were obtained. Consequently, live metadata access is observed; live vector download and import are not verified. Adapter tests must use labelled fixtures and simulated transport, not manufacture a successful live receipt.

## What NIH provides

The NIH BioArt FAQ lists SVG, AI, EPS and PNG downloads without requiring an account. Rights are entry-specific: its guidance distinguishes public-domain material from attribution-required Creative Commons material. Arc must preserve each entry's actual license and credit instead of assigning one license to the whole collection. A familiar NIH source is not, by itself, a scientific-validity check. [NIH BioArt FAQ](https://bioart.niaid.nih.gov/faqs), [NIH BioArt terms](https://bioart.niaid.nih.gov/terms).

### Observed interface

Public-page inspection found these routes and data on the research date:

| Object | Public route | Observed content |
|---|---|---|
| Search | `/discover?q=antibody&sort=relevance` | Seven antibody-related entries |
| Antibody entry | `/bioart/18` | Eleven representations, entry credit and license |
| Syringe entry | `/bioart/505` | Representation-to-format file mapping |
| File reference | `/api/bioarts/18/files/626859` | PNG reference in the antibody entry; not a successful file transfer |

The detail-page server-rendered HTML carries JSON-encoded Next flight records containing `carouselItems` and `filemapping`. These can be JSON-decoded without evaluating JavaScript. In contrast, the captured initial search HTML is a shell: the seven hits were observed only in the browser-rendered DOM. An opaque download server-action identifier also appeared in the public script; it is unsuitable as a durable integration contract. A detail page initially displayed no downloadable files until a representation was selected, even though its metadata already contained the file mapping. [Antibody entry](https://bioart.niaid.nih.gov/bioart/18), [Syringe entry](https://bioart.niaid.nih.gov/bioart/505).

The antibody entry identified Ryan Kissinger, NIAID Visual & Medical Arts, Courtesy of NIAID, and Public Domain. Its explicitly grey representation is group 64, with AI `626856`, EPS `626857`, PNG `626859` and SVG `626860`. The syringe's group 1943 maps AI `636180`, EPS `636181`, PNG `636183` and SVG `636184`. These are source-derived parser fixtures, not a promise that these IDs or the site's serialization will remain unchanged.

No documented stable public API was found. This is an observed website interface. Failures to recognize its schema must be reported as schema drift, not as a successful search with no results. Public browser assistance is an explicit, bounded fallback for JavaScript-dependent pages, never a response to a denied request.

## Efficient, reliable access

The following are Arc engineering decisions, not NIH service guarantees:

| Boundary | Default or rule | Reason |
|---|---|---|
| Network consent | Explicit opt-in; cache-only otherwise | No hidden research-data egress |
| Metadata | 8 MiB maximum; 24-hour TTL | Bound parsing cost and repeat traffic |
| Asset | 32 MiB per file | Bound transfer and memory exposure |
| Project cache | 256 MiB budget | Prevent unbounded collection mirroring |
| Request | 30-second timeout; at most two transient retries | Predictable failure rather than an endless loop |
| Origin | Fixed NIH origin; no arbitrary redirects | Avoid treating page data as a fetch instruction |
| HTTP 401/403 or policy denial | Stop | No alternate-host or browser bypass |
| HTTP 429 | Bounded Retry-After | Respect throttling without indefinite blocking |
| Reuse | Independently verify SHA256 and regular-file status | Detect corrupt or substituted cached bytes |
| Unknown license | Review required | Do not infer reuse rights |

Search, inspect and fetch are separate operations. Fetch only a format/file ID present in the selected entry's own representation map. Prefer an explicitly grey or black-and-white representation when available; never recolor an original silently. Store citation, collection, creator, credit, license, page hash, retrieval time, representation and byte hash in a receipt alongside the immutable original.

Use atomic writes and content-addressed objects. A cache hit should make zero HTTP requests. A missing or stale item without network consent should produce a useful error. Size, MIME, decoding, redirect, timeout, malformed metadata and symlink cases need offline fault-injection tests. A successful fetch and an eligible preview/import are different states: AI/EPS remain archive-only, and SVG/PNG must pass the existing safety checks. Unsupported Illustrator SVG features are an import limitation, not a reason to loosen the validator.

The first implementation deliberately automates fetch/import only for an exact `Public Domain` entry license. Other licenses are inspectable but blocked pending a separately reviewed policy; this is narrower than the full NIH catalog. Its hardened cache also requires POSIX no-follow/descriptor primitives and fails explicitly where those are unavailable. Windows asset intake is therefore not established by the native launcher's portability. Browser-assisted search uses an explicit local rendered-HTML snapshot, labelled with its operator-supplied origin, query and hash; it does not claim to authenticate the page or run Playwright automatically.

An independent review reproduced a timeout defect: buffered incoming chunks delayed a one-second check until 500 simulated seconds. The amended owned transport runs in a killable subprocess, with a parent deadline covering setup, native DNS, headers, body and retries; cancellation reaps the child before removing temporary results. Focused tests cover slow trickles and native blocking without making a live NIH request. Injected custom transports remain a separately documented trusted integration boundary. This is an engineering test result, not a claim about NIH availability.

## Rust: a narrow, measurable boundary

| Approach | Benefit | Cost or limitation | Decision |
|---|---|---|---|
| Rewrite all scientific code in Rust | Potential control of memory and throughput | Reimplementation and scientific-equivalence burden | Defer until a measured bottleneck justifies it |
| Rust supervisor + current worker | Native config validation and process lifecycle; preserves validated calculations | Python and native scientific dependencies remain | Implement this increment |
| Tauri 2 + HeroUI | Reuses the web UI and system webview with Rust application logic | Desktop packaging, webview differences, signing and updater policy need testing | Preferred later desktop layer |
| Bundled-browser desktop wrapper | Consistent browser runtime | Adds a browser distribution; does not accelerate the worker | Not selected for this increment |

Tauri's official architecture supports web frontends with Rust application logic and uses the operating system's webview. That supports the proposed integration, but framework example sizes do not measure Arc Science. The recommendation is an engineering inference, not a performance result. [Tauri 2 introduction](https://v2.tauri.app/start/).

The native executable should initialize a strict project-local TOML file, inspect configuration, report local dependencies and launch `python -m arc_science` through an argument vector. It must not concatenate shell text, install dependencies at startup, store credentials in TOML or silently open a public network listener. BioArt configuration must reach the actual Python provider; decorative settings are not an implementation.

Cancellation must cover the worker's descendants as well as the immediate Python process. The maintained `process-wrap` crate exposes standard-process wrappers for Unix process groups and Windows job objects. It is a candidate abstraction for this boundary; the pinned version and tested behavior must be recorded by the implementation, not inferred from documentation alone. [process-wrap API](https://docs.rs/process-wrap).

Linux build, test, binary-size and command-resource measurements belong in the verification record. Windows and macOS CI configuration is not evidence that those platforms have run successfully. A small supervisor is also not a low-memory replacement for Blender or the scientific worker.

## HoH and scientific evaluation

The HoH paper distinguishes evolving project artifacts from the fixed model, base harness, role definitions and runtime policy within a run. Its planner, developer and independent QA roles motivate a single-writer implementation path and evaluation of frozen candidates. Arc's interpretation is bounded candidate development with preserved evidence and permission stops, not unrestricted self-modification until a model declares success. [HoH paper, inspected PDF pages 1–5](https://arxiv.org/abs/2609.01481).

Artifact-centered claim-aware observability proposes stable artifact identities, explicit claim-to-evidence bindings, evaluator records, lineage and preserved steering/selection events. It presents a profile and worked examples, not evidence that recording provenance makes conclusions true. Arc should distinguish derivation from support: a sentence can come from a draft without being supported by its data. Claims should retain a supported, contradicted, unsupported or review-needed status. This is a proposed audit direction; full interoperability with the paper's profile is not claimed. [Yin et al., inspected PDF pages 2–8 and 11–12](https://arxiv.org/abs/2608.18312).

A recent rendering-consensus study reports an instructive failure: a broken backend caused ostensibly different chart renderings to fall back to the same renderer. Correcting the backend changed the comparison, and consensus-based self-training still reduced held-out accuracy in the reported experiments. For Arc, record the renderer actually used and its fallback rate. Visual agreement is not ground truth, and the study's outcomes should not be generalized to every model or task. [Rendering-consensus study, inspected appendix pages 20–21](https://arxiv.org/abs/2608.05670).

### Practical acceptance rules

- Keep source data, units, uncertainty, contact tables and coordinate-derived structure identities intact through layout changes.
- Bind every visual review to exact candidate hashes, native dimensions, evaluator identity and rubric. Keep failed candidates and disagreement visible.
- Measure candidate diversity and held-out correctness; do not promote repeated variants on appearance alone.
- Keep collage backgrounds exactly white, with restrained blue/grey molecular defaults. NIH schematics must not masquerade as molecular geometry.
- Treat theorem-prover success as a separate qualification. No Lean-backed proof execution is established by this increment; prose confidence and passing ordinary tests cannot substitute for it.
- Stop on exhausted budgets, missing evidence or access restrictions. “Try multiple ways” means permitted, meaningfully different approaches, not bypasses or infinite retries.

## Related composition and proof requirements

For the requested programming/ML block diagrams, the recommended later editor is React Flow with ELK for nested graphs and edge routing; Dagre is a simpler option for small directed trees. React Flow does not supply its own automatic layout engine. Arc should export from a shared node/edge model into a controlled SVG compositor, so graph editing and publication layout do not depend on screenshotting a live DOM. This is a framework recommendation, not a shipped diagram editor. [React Flow layout comparison](https://reactflow.dev/learn/layouting/layouting).

For mathematical claims, a successful Lean build is not the whole trust boundary. Lean's current manual distinguishes statement meaning from proof validity, recommends axiom inspection and fresh kernel rechecking, and describes sandboxed comparator/external-checker validation for adversarially supplied proofs. Unreviewed generated proof code must not execute in the main scientific service. Arc's future gate should bind a trusted theorem statement, pinned toolchain/dependencies, isolated build, permitted-axiom policy, proof-checker output and exact hashes; missing verification must remain unqualified. A text scan for `sorry` alone cannot establish this. No such gate was executed or shipped in this increment. [Lean: validating a proof](https://lean-lang.org/doc/reference/latest/ValidatingProofs/).

MD figure composition likewise needs an actual trajectory/analysis result, units and sampling/uncertainty information. The supplied 1DQJ contact matrix is static structural analysis, not an MD result. Photoshop-like layer editing and BioArt schematics cannot supply absent measurements.

## Selected tools: actual contribution

| Tool | Result in this increment |
|---|---|
| Superpowers | Task specifications, implementation/review boundaries and verification evidence |
| Supericons | Semantically checked Lucide atom, search and download icons; source manifest and license notices |
| Superdesign | CLI was unauthenticated; login timed out; no generated design is claimed |
| Parallel Search | Primary NIH pages and access/licensing research |
| Undermind | Recent scientific-agent and evaluation paper discovery with exact bibliographic identifiers |
| alphaXiv | Raw PDF passages for HoH, claim-aware observability and rendering-consensus analysis |
| Jinkō | Domain routing inspected; no QSP/ODE study was needed or submitted for asset access/native configuration |
| GitHub | Connector unavailable on recheck; local development continues under the user's explicit authorization |

## Remaining qualifications

The release verification record is authoritative for executed tests and measurements. Live NIH vector transfer, a new Superdesign draft, browser pixel review of the new workbench, live provider-based visual review, Lean proof execution, signed desktop installers, Windows/macOS runtime certification and GitHub publication remain distinct qualifications. None follows automatically from local unit tests or a successful source archive.
