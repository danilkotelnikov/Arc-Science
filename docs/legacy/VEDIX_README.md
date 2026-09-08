# Vedix

An end-to-end agentic research workbench that turns a topic into a venue-ready manuscript. Runs natively inside Claude Code, Codex CLI, Gemini CLI, and Antigravity — same skill, same 17 subagents, same MCP servers, same artifact set on each host.

Vedix searches the literature, generates ideas, writes a hypothesis, codes and runs the experiment, drafts the manuscript, peer-reviews itself, validates every figure visually, and emits a compiled PDF plus a Word twin. Every numerical claim, citation, and figure caption is traced back to a source via the Source-Grounded Claim Architecture — the model cannot insert assertions that it didn't ground in a primary source.

## What it does

- **Literature → manuscript in one command.** Nine MCP-backed sources (OpenAlex, Semantic Scholar, arXiv, bioRxiv, PubMed, Anna's Archive, fetcher, plus the bundled knowledge store and per-project MemPalace memory) feed a pipeline of 17 specialized subagents.
- **Source-Grounded Claim Architecture (SGCA).** Every sentence in the manuscript is bound to an allowed-set of evidence drawn from the literature, the experiment ledger, and the codebase. The numerical-claim audit and the citation-graph audit re-verify before stage-gate exit.
- **Cross-host parity.** The same skill prompt and the same agent definitions run on Claude Code's `Task` tool, Codex's `spawn_agent`, and Gemini CLI's inline reasoning. Each agent declares per-host model pinning in its frontmatter.
- **23 publisher templates and seven first-class languages.** Render the same manuscript into Nature, Elsevier, IEEE, ACM, Frontiers, Wiley, Sage, MDPI, Springer-Nature, RSC, ACS, IOP, AIP, APS, Cell, PLOS, BMJ, Lancet, JAMA, Russian-region journals, and four more — in English, Russian, Spanish, German, French, Chinese, or Japanese.

## Install

One command on Linux, macOS, or Windows. The bootstrap detects which CLI hosts you have (Claude Code, Codex CLI, Gemini CLI), asks which to register into, installs Python deps, merges Codex config idempotently, runs the MCP self-test, and prints the slash commands you paste into Claude Code.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/danilkotelnikov/vedix/master/scripts/bootstrap.sh | bash
```

**Windows (PowerShell):**

```powershell
iwr -useb https://raw.githubusercontent.com/danilkotelnikov/vedix/master/scripts/bootstrap.ps1 | iex
```

For Claude Code specifically, after the bootstrap finishes:

```
/plugin marketplace add danilkotelnikov/vedix
/plugin install vedix@vedix
```

Re-running is safe. The bootstrap is idempotent.

## Set one env var

OpenAlex made API access mandatory on 2026-02-13. Vedix uses your email as the polite-pool identifier:

```bash
export OPENALEX_EMAIL="you@example.com"
```

Everything else (Semantic Scholar key, Anna's Archive key, provider API keys) is optional and individually unlocks more functionality.

## Quickstart

From inside any supported host:

```
/vedix solvent polarity effects on Diels-Alder kinetics
```

Or in plain English — the skill auto-routes to the right subset of agents:

```
review my paper at C:/papers/draft.tex
build a plot from losses.npy
find papers on attention mechanisms
compare RWKV vs Mamba experimentally
```

Outputs land in `~/.vedix/jobs/<job_id>/`:

```
manuscript.pdf
manuscript.docx
manuscript.tex
references.bib
results.csv
experiment.py
figures/
sgca/sentence_ledger.jsonl
rigor/{citation_graph,counterfactual,adversarial_review,provenance}.json
logs/orchestrator.log
```

## How it works

The Python orchestrator at `plugins/vedix/mcp/lib/orchestrator/pipeline.py` owns retries, token accounting, semantic convergence, ensemble reviewers, stage-gate verification, and the SGCA ledger. The MCP server emits dispatch instructions; the host CLI invokes the matching subagent via its native mechanism and returns the output. The pipeline owns the state machine — agents are stateless workers.

| # | Subagent | Role |
|---|---|---|
| 1 | `ideator` | Generate research ideas, novelty-check against OpenAlex / Semantic Scholar |
| 2 | `codebase-scanner` | Map a target repo into entry points, modules, extension points |
| 3 | `literature-searcher` | Six-source parallel literature pull (one worker per source) |
| 4 | `hypothesizer` | Testable hypothesis with mathematical model + statistical framework |
| 5 | `code-generator` | Experiment script + `requirements.txt` per the domain template |
| 6 | `experiment-runner` | Install deps, run, parse stderr, patch up to 3 rounds |
| 7 | `tree-search-runner` | Best-First Tree Search variant explorer (gated on `--bfts`) |
| 8 | `plotter` | Three-cycle iterative figure refinement + Okabe-Ito palette |
| 9 | `paper-extractor` | Pull structured facts out of cited papers into the allowed-set |
| 10 | `manuscript-writer` | Six parallel section-writers (Abstract, Intro, Methods, Results, Discussion, Conclusion) |
| 11 | `citator` | Bidirectional citation enrichment, up to five rounds |
| 12 | `reviewer` | NeurIPS-style multi-pass adversarial review |
| 13 | `vlm-reviewer` | Vision-language figure review — duplicates, caption-content alignment |
| 14 | `meta-analyst` | Cross-job success-rate and failure-pattern aggregation |
| 15 | `fixer` | Diagnose pipeline failures and surface 2-4 fix options |
| 16 | `slide-presenter` | Beamer PDF + python-pptx editable deck + speaker notes |
| 17 | `codex-cross-validator` | Claude Code-exclusive — cross-checks every ideation, hypothesis, codegen, manuscript, review output against Codex via the [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) bridge |

## Source-Grounded Claim Architecture

Each manuscript sentence carries an entry in `sgca/sentence_ledger.jsonl`:

- The sentence text.
- The allowed set of supporting evidence (paper DOIs, experiment-result IDs, codebase line references).
- The verifier verdict (`supported` / `partial` / `unsupported`).
- The author agent and the timestamp.

Any sentence that fails verification triggers a re-write before the manuscript exits its stage gate. The same ledger drives the post-experiment numerical-claim audit (`numerical_audit.json`) and the citation-graph audit (`citation_graph.json`).

## Register quality gate

Three complementary checks confirm the manuscript reads as genuine academic prose, not AI-stylistic or popular-science register:

- **`anti_llm_lint`** — a measured trigger-word blacklist (`delve`, `underscore`, `it is important to note`, paragraph-initial `Furthermore,` …) sourced from post-ChatGPT excess-vocabulary studies. Catches known words.
- **`linguistic_audit`** — per-locale typographic and terminology rules (guillemets, decimal comma, GOST citations for Russian; Oxford-comma and smart-quote consistency for English; seven locales). Catches script-level slips.
- **Trained register classifier** — a per-(discipline, language) `xlm-roberta-base` model (the §5.3 Layer B discriminator) that scores each paragraph's probability of being in academic register. Catches the statistical signal no keyword list can express: a paragraph that reads as popular-science ("Scientists have made a major discovery!"), encyclopedic, or conversational gets flagged even when it contains no blacklisted words.

The classifier is wired into the pipeline through [`register_gate.RegisterGate`](plugins/vedix/mcp/lib/orchestrator/register_gate.py), configured under `orchestrator.register_discriminator` in settings. After the manuscript phase it judges every paragraph and writes `register_audit.json` (per-paragraph verdicts + `pass_fraction` + `flagged_paragraphs[]`). The reviewer agent reads it as part of its checklist. The gate degrades gracefully: if no trained model exists for the discipline/language, or torch is absent, every paragraph passes and the audit records `skipped` with a reason — the pipeline never blocks for lack of a model.

Models are loaded lazily (only when a manuscript needs judging) and cached per job. Train your own with `scripts/prepare_corpus.py` → `scripts/scrape_popsci.py` → `scripts/rebuild_splits.py` → `scripts/train_register_classifier.py --auto`, or fetch pre-trained weights with `python -m vedix model fetch`. Trained weights land in `~/.vedix/classifiers/register_<discipline>_<language>/`; `python -m vedix model list` shows what's installed with each model's held-out F1.

## Corpus acquisition

Full-text acquisition is a first-class pipeline phase. The literature-searcher returns metadata; the orchestrator then runs [`corpus_acquisition.CorpusAcquisitionPipeline`](plugins/vedix/mcp/lib/orchestrator/corpus_acquisition.py) on each merged paper, a three-stage cascade with provenance recording at every step:

1. **DOI gate** — every candidate goes through [`cross_validator.stage1_doi_gate`](plugins/vedix/mcp/lib/orchestrator/cross_validator.py): Crossref / DataCite resolve plus a token-sort title-fuzzy threshold of 0.85. Failures short-circuit; the rejected DOI never reaches the network beyond the registry probe and the failure is recorded on the `crossref_gate` source channel.

2. **OA-direct** — the pipeline queries OpenAlex's single-work record and walks `best_oa_location.pdf_url` then `oa_locations[]` then `locations[]` (filtered to known legitimate-OA hosts: arxiv, biorxiv, medrxiv, chemrxiv, osti.gov, pmc.ncbi.nlm.nih.gov, hal.science, escholarship.org, eprints.*, tspace, and `nature.com/articles/*_reference.pdf` for hybrid-OA Nature). Browser-headers download with `%PDF-` magic-byte validation. Hosts that 403 anonymous clients (pubs.acs.org, link.aps.org, thelancet.com) are intentionally excluded from the walk.

3. **Sci-Hub MCP (gentle, opt-in)** — when `corpus.use_scihub_fallback=true` AND OA returned nothing, the pipeline calls `search_scihub_by_doi` + `download_scihub_pdf` through the patched MCP at `~/.vedix/external/Sci-Hub-MCP-Server/` with a configurable `pace_seconds` wall-clock delay between papers (default 25). The MCP wrapper itself is fixed for current sci-hub.ru HTML, browser-headers download, and stdio JSON-RPC compatibility — see [`plugins/vedix/scripts/patch_scihub_mirrors.py`](plugins/vedix/scripts/patch_scihub_mirrors.py) for what got patched in the upstream package.

Every successful acquisition emits three artifacts:

- A `SourceLedger.record_call(source=..., success=True, records_added=1)` entry in `<output_dir>/source_usage.json` — per-source attempted / successful / failed / rate_limit_hits counts.
- A paper-skeleton [`KGFragment`](plugins/vedix/mcp/lib/orchestrator/sgca/schema.py) in the job's SGCA knowledge-graph store at `<output_dir>/.palace/vedix_kg__job__<job_id>/` — paper metadata + license + `raw_pointer` to the on-disk PDF/text. Downstream paper-extractor and claim-verifier agents populate claims/methods/results.
- A line in `<output_dir>/downloaded.jsonl` with the resolving URL, the OA host that served the PDF, and the license tag.

The reviewer and citator agents read `source_usage.json` plus the KG store as part of their checklist. Citations whose DOI never made it through the pipeline (no ledger entry or `success: false` without the `vedix-metadata-only` bib flag) are listed as "uncorroborated" in the review output.

Standalone scrape scripts are also provided for batch corpus building outside of a manuscript job:

| Script | Channel | Pacing |
|---|---|---|
| [`scripts/scrape_oa.py`](scripts/scrape_oa.py) | OpenAlex `is_oa:true` + relaxed `locations[]` walk | publisher rate-limit only |
| [`scripts/scrape_scihub.py`](scripts/scrape_scihub.py) | Sci-Hub MCP (via patched mirror+parser) | `--pace-seconds N`, default 1 for batch, 25-60 for gentle |
| [`scripts/scrape_journals.py`](scripts/scrape_journals.py) | Anna's Archive | 30/60/120/240 s backoff on 429 |
| [`scripts/backfill_text_extracts.py`](scripts/backfill_text_extracts.py) | pdfminer recovery for missing text files | n/a |

## Bundled MCP servers

The install registers nine MCP servers in your host config. Eight are external; one is bundled with Vedix.

| MCP | Source | Role |
|---|---|---|
| `vedix` | bundled | Knowledge store (SQLite FTS5 + ChromaDB), codebase analyzer, meta-analysis |
| `mempalace` | [MemPalace/mempalace](https://github.com/MemPalace/mempalace) | Per-project memory; auto-saves before context compaction |
| `openalex` | [drAbreu/alex-mcp](https://github.com/drAbreu/alex-mcp) | 240M+ scholarly works |
| `semanticscholar` | [JackKuo666/semanticscholar-MCP-Server](https://github.com/JackKuo666/semanticscholar-MCP-Server) | Semantic Scholar full API |
| `arxiv` | `arxiv-mcp-server` | Preprints (CS, physics, math, bio) |
| `biorxiv` | [JackKuo666/bioRxiv-MCP-Server](https://github.com/JackKuo666/bioRxiv-MCP-Server) | Life-sciences preprints |
| `pubmed` | `pubmed-mcp` | Biomedical literature |
| `annas-mcp` | `annas-mcp` | Anna's Archive full-text |
| `scihub` | [JackKuo666/Sci-Hub-MCP-Server](https://github.com/JackKuo666/Sci-Hub-MCP-Server) (patched at install) | Full-text fallback for paywalled DOIs; gentle-paced |
| `fetcher` | `fetcher-mcp` | HTTP fallback for Consensus and Crossref |

## Memory: per-project, no cross-project leakage

Two layers:

- **Cross-job global knowledge** — `~/.vedix/knowledge.db` (SQLite + ChromaDB). Papers, hypotheses, benchmark outcomes, claims, knowledge-graph triples, trajectories.
- **Per-project palace** — `<output_dir>/.palace/`. Wings → rooms → drawers (conversation context, agent diaries, intermediate states). Lives inside the job directory; deleting the project removes the palace.

Every agent calls `mcp__mempalace__wake_up(root="<output_dir>/.palace")` on entry and `mcp__mempalace__mine(root="<output_dir>/.palace")` on exit. Agents never read or write any other palace path.

## Native dispatch, BYOK as optional fallback

By default Vedix dispatches through the host CLI's native subagent mechanism (Task tool, `spawn_agent`, inline reasoning). The host's authentication carries the LLM cost — no extra API key needed.

If you want to route specific phases through a different provider, opt into the Bring-Your-Own-Key chain:

```bash
python -m vedix provider add anthropic --api-key "<key>"
python -m vedix provider add openai    --api-key "<key>"
python -m vedix provider set-chain anthropic openai
```

Fourteen providers supported: Anthropic, OpenAI, Google, DashScope (Qwen), GigaChat, Mistral, Cohere, plus seven more. Each adapter is lazily imported so installing only the SDKs you actually configure is fine.

## Configuration

User overrides go in `~/.claude/settings.json` (Claude Code), `~/.codex/config.toml` (Codex), or `~/.gemini/settings.json` (Gemini):

```json
{
  "plugins": {
    "vedix": {
      "agents": {
        "reviewer": { "model": "sonnet", "thinking_budget": 32000 }
      },
      "literature": { "max_papers": 30 },
      "experiment": { "use_bfts": true, "bfts_time_budget_minutes": 60 },
      "memory": { "scope": "project", "isolation": "strict" }
    }
  }
}
```

Full schema at [`plugins/vedix/settings/settings.schema.json`](plugins/vedix/settings/settings.schema.json).

## Tests

```bash
cd plugins/vedix && python -m pytest tests/
python plugins/vedix/mcp/server.py --selftest
```

The pytest suite covers per-host agent frontmatter, routing fixtures, the MCP self-test, the v2→v3 migration helper, and the orchestrator unit suite.

## Manual install paths

For each host, the bootstrap is the supported path. If it can't run in your environment, walk through the manual guides:

- Claude Code — [docs/INSTALL_CLAUDE_CODE.md](docs/INSTALL_CLAUDE_CODE.md)
- Codex CLI — [.codex/INSTALL.md](.codex/INSTALL.md)
- Gemini CLI — [.gemini/INSTALL.md](.gemini/INSTALL.md)
- LLM-driven — [docs/AGENT_INSTALL_PROMPTS.md](docs/AGENT_INSTALL_PROMPTS.md) (copy-paste prompts the agent follows)

## Credits

- [Sakana AI's AI-Scientist-v2](https://github.com/SakanaAI/AI-Scientist-v2) (MIT) — the canonical Python pipeline (BFTS, `perform_writeup`, `perform_vlm_review`, `perform_llm_review`, `perform_plotting`) is bundled under `plugins/vedix/mcp/lib/sakana/`.
- [MemPalace](https://github.com/MemPalace/mempalace) (MIT) — per-project memory DB.
- [drAbreu/alex-mcp](https://github.com/drAbreu/alex-mcp), [JackKuo666/semanticscholar-MCP-Server](https://github.com/JackKuo666/semanticscholar-MCP-Server), [JackKuo666/bioRxiv-MCP-Server](https://github.com/JackKuo666/bioRxiv-MCP-Server) — MCP wrappers for OpenAlex, Semantic Scholar, and bioRxiv.

## License

MIT — see [LICENSE](LICENSE).
