# Rust roadmap — what moved in the 2026-09-20 program and what remains

The user's request was that "all the components must be written as Rust/C++ modules
for faster management". The program's stated boundary (see
[program](2026-09-20-program.md), assumptions): management, launch, configuration and
the desktop shell move to Rust; the scientific computation stays in Python, where the
libraries live, behind the Rust supervisor as a replaceable module. This document
records what is in Rust after the program, what is still Python, and the ordered plan
for the rest, with the boundary each step keeps. Nothing here is a schedule.

## In Rust now (four crates, about 5,100 lines)

| Crate | Owns | Since |
| --- | --- | --- |
| `arc-science-native` (the supervisor) | Process acquisition and crash containment of the worker tree (`acquire.rs`, `containment.rs`, `process.rs`); runtime discovery for a launch without a shell (`discover.rs`: Python 3.11+, package root, sibling components, contained probes); the startup plan; `arc-science.toml` (`config.rs`); the operator settings — one typed schema, one validator, one writer with revisioned, locked, atomic replacement (`settings.rs`); the BioRender export boundary (`bioart.rs`) | 2026-09-18 program; discovery and settings in this program (loops 1, 3) |
| `arc-desktop` | The native window; self-configuration from a double-click (`launch.rs`: supervisor lookup, workspace under local application data, window first, health-gated workbench, native failure dialog with the redacted stderr tail); the local startup contract (`startup.rs`); external links (`external.rs`) | 2026-09-18 program; launch in this program (loop 1) |
| `arc-memory` | The SQLite session-memory engine and its stdio worker protocol (`arc-memory/1`), embeddings behind a trait | 2026-09-19 program |
| `arc-svg` | SVG rasterisation with resvg and system fonts (`arc-svg2png`) | earlier |

## Still Python (about 55 modules, 12,200 lines in the package and `exploration`) and why

| Area | Modules | Why it stays for now |
| --- | --- | --- |
| Service and routes | `service.py`, `transport.py`, `settings.py` (the reader side), `cli.py` | The HTTP contract every workspace and test speaks; moving it before the science moves would put the boundary in the wrong place |
| Missions and claim scope | `exploration/engine.py`, `claim_scope.py`, `release.py`, `evidence.py`, `providers.py`, `cli_seats.py`, `mcp_tools.py`, `acp_client.py`, `vision.py` | Provenance, claim eligibility and the seat adapters (Claude Code, Codex, Gemini CLI, HTTP providers, MCP, ACP) are the part under most frequent evaluation; Rust would freeze them mid-argument |
| Molecular pipeline | `molecular_figure.py`, `molecular_worker.py`, `molecular_jobs.py`, `render_presets.py`, `molecular_catalogue.py`, `figure_*.py` | Blender's Python API, gemmi, Biopython and RDKit are Python libraries; the worker already runs in its own process under the supervisor |
| Prose | `prose.py`, `prose_humane.py` | Small, rule-based, and tied to the behaviour text; a candidate for the first port |
| Numerical tools and memory client | `exploration/tools.py`, `memory/` | NumPy and SciPy; the memory client speaks to the Rust engine already |

## The order for the rest

Each step moves one module across the existing process boundary and keeps the HTTP
contract, the tests and the provenance records unchanged; a step is done when the
Python module is deleted and every suite is green against the Rust replacement.

1. **Secret files and the credential store** — `credential_path`, `_secret`, the
   token file and the audit key move to the supervisor (`arc-science credential`
   already exists as a Python command; the supervisor owns the settings that name the
   credentials). Boundary kept: the service asks the supervisor for a grant, never
   reads the file. Smallest step, closes the ACL work in one owner.
2. **Prose rules and protection** — `prose.py`'s rule table and protected-span
   scanner are regular expressions and byte comparisons; a Rust binary behind the
   same `/api/prose/*` routes, the behaviour text served from the same packaged file.
   Boundary kept: no egress, the audit's keyed hash unchanged.
3. **Catalogue probes** — `molecular_catalogue.py`'s process probes (PATH, Program
   Files, WSL listings, daemon status) belong beside `discover.rs`, which already runs
   contained probes; the Python interpreter probe stays a subprocess of the Python
   the service runs. Boundary kept: presence only, indirect evidence apart.
4. **Render job lifecycle** — `molecular_jobs.py`'s stage watcher, event stream and
   scene/source serving move to the supervisor, which already contains the worker
   tree; the Blender worker itself stays Python. Boundary kept: provisional scenes
   bound to the source digest, stages as observations.
5. **Seat transports** — the CLI seat runner (`cli_seats.py`: scrubbed environment,
   job object, drained pipes, deadline, redaction) is process management and belongs
   in Rust; the HTTP adapters follow. Boundary kept: per-call provenance records with
   the same fields, requested-only identity for Codex.
6. **Service routes** — last, once the modules above are Rust: the FastAPI layer
   becomes a Rust HTTP service with the same contract, and the Python package is the
   science worker only (missions' numerical tools, the molecular pipeline).

Not planned: porting NumPy, SciPy, gemmi, RDKit or Blender's API. The science stays
in the language of its libraries; the management around it is what "faster
management" can honestly mean here.
