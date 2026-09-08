# BioArt access and portable setup: continuation research

Research checked 8 September 2026. This addendum extends, rather than replaces, [the original BioArt/native research](bioart-native-research.md). It distinguishes source evidence, implementation requirements and unqualified capabilities.

## NIH access: what can be relied on

NIH describes BioArt as a freely accessible collection made by professional medical illustrators, with search filters and EPS, AI, PNG and SVG downloads. No account is required. That supports on-demand asset intake; it does not establish a supported bulk API or availability guarantee. [NIAID resource description](https://www.niaid.nih.gov/research/nih-bioart-source).

Licensing remains per entry. Public-domain entries and attribution-required entries are distinct; keep the actual entry credit, creator, collection and citation. The FAQ explains citation practice, while the terms explicitly caution that content is not guaranteed error-free or complete. A familiar provider is not scientific validation. [BioArt FAQ](https://bioart.niaid.nih.gov/faqs), [BioArt terms](https://bioart.niaid.nih.gov/terms).

### Efficient intake policy

These are Arc engineering choices, not NIH promises:

| Need | Mechanism | Failure remains visible |
| --- | --- | --- |
| Choose a reusable vector | SVG by default; filter representations by requested format before preferring an explicitly neutral caption | No compatible format; manual representation override never silently substituted |
| Keep muted figure styling | Prefer neutral-labelled source art; retain original bytes and selected caption | Caption is metadata, not pixel-based color analysis; no automatic recoloring |
| Avoid redundant transfers | Project-local content-addressed cache; verify receipt/page/source hashes on reuse | Stale metadata without explicit egress, corruption and budget exhaustion reject |
| Bound cost | Existing 8 MiB metadata, 32 MiB file and 256 MiB cache defaults; 30-second request budget and at most two retries | No unbounded mirroring, retry storm or invisible eviction of provenance |
| Preserve usable sources | SVG safety validation and immutable import; keep AI/EPS as archive-only and PNG as preview-only | Unsupported SVG constructs are not sent to a permissive converter |
| Handle changing website structure | Parse observed entry-bound JSON records; fail on schema drift | Initial search HTML may be a client shell, not an empty catalog |
| Browser assistance | Explicit operator-supplied rendered HTML with its own source label/hash | No automatic Playwright response to denial or unsupported browser policy |

The continuation reduces manual IDs, not validation. Automatic selection must first consider whether the requested format exists, match neutral words rather than arbitrary substrings, use deterministic source-order ties and honor explicit choices. The selected representation/file IDs remain in the same independently verified receipt as manual fetches.

“All required vectors” means assets selected for a concrete figure and eligible under their entry metadata. It does not mean copying the entire collection, importing every format, or assuming all entries share one license. A later batch planner should freeze selected entry/group/file identities, estimate total byte limits, deduplicate requests, preserve partial successes and report failures individually. No such bulk scheduler is claimed here.

Live vector transfer remains unverified: the previously cancelled file-transfer approval is still a stop condition. New tests must use labelled synthetic bytes and local metadata fixtures. Browser or alternate-host download is not a workaround.

## Rust and operating systems

The existing Rust supervisor is the practical boundary: native configuration/argument validation and process ownership, with Python retained for the scientific and asset worker. The continuation adds direct typed BioArt commands and `init --python` to reduce configuration mistakes without adding a second provider implementation. Rust's `Command` API accepts arguments separately; its documentation also warns that Windows command interpreters and batch files have special parsing behavior. Arc continues launching executables directly, not a shell. [Rust Command](https://doc.rust-lang.org/std/process/struct.Command.html).

Select an environment's interpreter explicitly. Python documents different environment layouts on Windows (`Scripts`) and POSIX (`bin`), and environment activation is not required when using the interpreter path. Initialization should serialize the user's selected path safely, preserve venv symlink identity and never install packages or execute an interpreter as an implicit setup action. [Python venv](https://docs.python.org/3/library/venv.html).

| Layer | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Rust init/config/doctor | Executable tests/build available in this environment | CI source configuration; runtime unexecuted here | CI source configuration; runtime unexecuted here |
| Default interpreter name | `python3` | `python3` | `python` |
| Explicit venv executable | `bin/python` | `bin/python` | `Scripts\\python.exe` |
| Python BioArt cache/import | POSIX path, offline tested | POSIX intended, not runtime-qualified here | Unsupported; reject explicitly before direct BioArt launch |
| Native detached-renderer force cancellation | Open I1 blocker | Unqualified | Unqualified |
| Signed desktop installer | Not supplied | Not supplied | Not supplied |

A full Rust scientific rewrite would require a measured workload bottleneck and numerical/scientific equivalence tests. Small launcher size or configuration timing cannot establish faster molecular rendering, inference or asset conversion.

Tauri remains a candidate desktop layer for the existing HeroUI frontend, not a shipped desktop build. Its prerequisites differ by OS: Linux requires system development libraries, macOS its native build tooling, and Windows C++ build tools/WebView2. A credible desktop release therefore needs per-OS builds, webview tests, signing and sidecar lifecycle tests; a scaffold or Linux build is insufficient. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Recent scientific-agent evidence and HoH

The HoH preprint describes iterative planning, development and independent testing around versioned artifacts. Figure 3 explicitly keeps the model, base harness, role definitions and runtime policy fixed during a run. The continuation applies that distinction: project code, bounded task scopes and evidence evolve; permissions and acceptance rules do not self-relax. The paper's software-development results are not validation of Arc's scientific claims. Raw pages 1, 2, 4 and 5 were examined through alphaXiv. [Harness-of-Harness](https://arxiv.org/abs/2609.01481).

The Replica/Faraday preprint evaluates figure replication from redacted papers. Its setup contains 310 tasks from 100 papers, separating 242 training tasks from 68 AI-for-science test tasks. Section 3.2 distinguishes visual similarity from faithful experiments, support for the claim and scientific integrity. Arc should borrow that separation in future figure evaluation: a beautiful collage cannot make absent measurements real. These are authors' benchmark results, not an independently replicated guarantee of autonomous science. Raw pages 1–5 were examined. [Training AI Scientists to Replicate Research](https://arxiv.org/abs/2608.13331).

Undermind supplied two additional relevant leads. Their abstracts and bibliographic metadata were examined, not full papers: *RaivenTracks* describes branchable validated visualization specifications with a three-researcher pilot; *Evaluating Agentic Bioinformatics through Function, Evidence, and Validation* separates workflow operations, traceable evidence and use-case validation. They motivate persistent checkpoints and separate scientific acceptance gates; their frameworks are not implemented or benchmarked by this increment. [RaivenTracks](https://arxiv.org/abs/2608.14869), [Function–Evidence–Validation](https://arxiv.org/abs/2607.27556).

## Named integrations and actual contribution

| Integration | Actual continuation result |
| --- | --- |
| Superpowers | Existing-spec continuation, test-first implementation, one writer and independent task/final review |
| Parallel Search | Current NIH resource, FAQ and terms discovery; only NIH primary guidance used for access conclusions |
| alphaXiv | Recent research discovery and raw HoH/Replica paper pages |
| Undermind | Targeted provenance/evaluation discovery and exact paper identifiers; no unrelated deep-search job |
| Supericons | Retrieved a coherent-library recommendation, then rejected semantically weak choices: settings for source and server controls for verified cache are misleading; retained existing checked icons |
| Superdesign | Existing HeroUI/minimal-white direction retained; prior login timeout remains a stop; no new draft generated |
| Jinkō | Router inspected; vector intake and native configuration do not require a QSP model, calibration or clinical trial; none was submitted |
| GitHub | Repository/known-commit reads succeeded; development-branch creation returned HTTP 403, `Resource not accessible by integration`; no retry or alternate authentication |

The separate verification record identifies exact implemented revision, tests and build outputs. This research addendum is not evidence of live vector retrieval, Windows/macOS execution, browser pixel review, an installed Tauri application, Lean proof checking or general state-of-the-art superiority.
