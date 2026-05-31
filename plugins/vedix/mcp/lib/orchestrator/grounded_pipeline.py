"""Grounded-pipeline ordering gate + grounding helpers.

This module encodes the hard ordering constraint the review test run
violated: **the manuscript writer must not start until the source graph
is built.** It also provides the grounding seams the writer and reviewer
use so claims are anchored to verbatim quotes from the original papers,
not to LLM recall.

The correct order the pipeline now enforces:

    literature search (metadata)
      -> corpus_acquisition: FULL TEXT for each source, substituting
         unobtainable sources (OA -> Anna's -> Sci-Hub, gently)
      -> GraphBuilder: per-paper KGFragment with verbatim_quote +
         byte-verified quote_byte_range, persisted to KGStore
      -> mark_graph_built(output_dir)            <-- the gate is now open
      -> manuscript writer: require_graph_built() first; cite ONLY claim
         nodes from the allowed-set the KG provides
      -> reviewer: verify each manuscript claim against the KG

If the graph is not built, :func:`require_graph_built` raises and the
writer phase refuses to run. That is the structural fix for the
"writer ran before any graph existed" failure.

Public surface
--------------
- :class:`GraphNotBuiltError`
- :func:`mark_graph_built` / :func:`is_graph_built` / :func:`require_graph_built`
- :func:`load_graph_manifest`
- :func:`paper_extractor_prompt` — the canonical extraction prompt a host
  agent (Task) or a Workflow ``agent()`` runs to produce a KGFragment YAML
- :func:`allowed_set_for_topic` — the KG claim nodes a paragraph may cite
- :func:`grounding_report` — KG coverage summary for writer/reviewer
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Optional


GRAPH_BUILT_MARKER = "graph_built.json"


class GraphNotBuiltError(RuntimeError):
    """Raised when a phase that requires a built source graph runs before
    the graph exists. The writer phase guards on this."""


# --------------------------------------------------------------------------- #
# The ordering gate
# --------------------------------------------------------------------------- #


def graph_built_marker_path(output_dir: Path) -> Path:
    return Path(output_dir) / GRAPH_BUILT_MARKER


def mark_graph_built(
    output_dir: Path,
    *,
    papers_extracted: int,
    papers_failed: int,
    claims_total: int,
    edges_total: int,
    kg_wing: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> Path:
    """Write the ``graph_built.json`` marker. Only the grounded-acquisition
    step should call this, and only after KGFragments are persisted."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "graph_built": True,
        "built_at": time.time(),
        "papers_extracted": papers_extracted,
        "papers_failed": papers_failed,
        "claims_total": claims_total,
        "edges_total": edges_total,
        "kg_wing": kg_wing,
    }
    if extra:
        payload.update(extra)
    p = graph_built_marker_path(out)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def is_graph_built(output_dir: Path) -> bool:
    """True iff a valid graph_built marker with >=1 extracted paper exists."""
    p = graph_built_marker_path(output_dir)
    if not p.exists():
        return False
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    return bool(data.get("graph_built")) and int(data.get("papers_extracted", 0)) >= 1


def require_graph_built(output_dir: Path) -> dict[str, Any]:
    """Return the graph manifest, or raise :class:`GraphNotBuiltError`.

    The manuscript-writer phase calls this FIRST. If it raises, the writer
    does not run — the structural guarantee that no manuscript is produced
    from an empty/ungrounded knowledge graph.
    """
    if not is_graph_built(output_dir):
        raise GraphNotBuiltError(
            f"source graph not built for job at {output_dir}. The writer "
            f"phase is blocked until corpus_acquisition + GraphBuilder have "
            f"produced byte-verified KGFragments and mark_graph_built() ran."
        )
    return load_graph_manifest(output_dir)


def load_graph_manifest(output_dir: Path) -> dict[str, Any]:
    p = graph_built_marker_path(output_dir)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


# --------------------------------------------------------------------------- #
# Extraction prompt (canonical paper-extractor contract)
# --------------------------------------------------------------------------- #


def paper_extractor_prompt(
    *, paper_id: str, doi: str, title: str, raw_text: str,
    raw_text_path: str, max_chars: int = 48_000,
) -> str:
    """Render the paper-extractor prompt for one paper's full text.

    Mirrors plugins/vedix/agents/paper-extractor.md + graph_builder's
    contract: emit a YAML KGFragment whose every claim carries a
    verbatim_quote that is a CONTIGUOUS substring of the raw text, with
    quote_byte_range giving exact byte offsets. The byte check is
    enforced downstream by GraphBuilder.ingest_fragment, so a fabricated
    or paraphrased "quote" is rejected (the paper is then substituted).
    """
    text = raw_text[:max_chars]
    truncated = " [TRUNCATED]" if len(raw_text) > max_chars else ""
    return f"""You extract a Source-Grounded Claim Architecture (SGCA) knowledge-graph
fragment from ONE scientific paper's full text. Output ONLY a YAML document.

Paper:
  paper_id: {paper_id}
  doi: {doi}
  title: {title}

HARD RULES (validated programmatically — violations reject the fragment):
1. Every claim's `verbatim_quote` MUST be an EXACT, contiguous substring of the
   raw text below — copy it character-for-character, do not paraphrase or fix typos.
2. Every `quote_byte_range: [start, end]` MUST satisfy raw_text.encode()[start:end]
   decoding to exactly verbatim_quote (use byte offsets into the raw text).
3. Extract 4-12 of the paper's most load-bearing empirical/methodological claims.
4. Never invent a claim the paper does not state.

YAML schema:
paper_id: {paper_id}
doi: {doi}
title: {title}
year: <int>
authors:
  - {{id: "author:<surname>", name: "<name>"}}
venue: <journal>
language: en
license: <license or "unknown">
raw_pointer:
  text: {raw_text_path}
  byte_len: <int length of raw text>
nodes:
  claims:
    - id: {paper_id}.claim01
      type: empirical | methodological | review | theoretical
      paraphrase: <one-sentence paraphrase>
      verbatim_quote: <EXACT substring of raw text>
      quote_byte_range: [<start>, <end>]
      page: <int or 0>
      section: <section name or "">
      confidence: <0.0-1.0 self-assessment>
      hedge: <true|false>
      provenance: {{extractor_model: "paper-extractor"}}
  methods: []
  results: []
  limitations: []
  entities: []
edges:
  - {{from: "paper:{paper_id}", to: "{paper_id}.claim01", kind: contains}}

Raw text{truncated}:
```
{text}
```"""


# --------------------------------------------------------------------------- #
# Writer grounding — allowed-sets from the KG
# --------------------------------------------------------------------------- #


def _tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", (s or "").lower())}


def allowed_set_for_topic(
    kg_store: Any,
    *,
    topic: str,
    max_size: int = 30,
) -> list[dict[str, Any]]:
    """Return the claim nodes a paragraph on ``topic`` may cite.

    Ranks every persisted claim by keyword overlap of its paraphrase +
    verbatim_quote against the paragraph topic, returns the top
    ``max_size`` as ``{claim_id, paper_id, doi, paraphrase, verbatim_quote}``.
    The writer is told to cite ONLY from this set — so each cited
    statement traces to a byte-verified quote in an acquired paper.

    (The embedding-based planner in :mod:`sgca.paragraph_planner` is the
    production upgrade; this keyword version is dependency-light and
    deterministic for the gate + tests.)
    """
    topic_toks = _tokens(topic)
    scored: list[tuple[float, dict[str, Any]]] = []
    try:
        paper_ids = kg_store.list_paper_ids()
    except Exception:  # noqa: BLE001
        return []
    for pid in paper_ids:
        paper = kg_store.read_paper(pid)
        if paper is None:
            continue
        doi = getattr(paper, "doi", "")
        for c in paper.nodes.claims:
            ctoks = _tokens(c.paraphrase) | _tokens(c.verbatim_quote)
            if not ctoks:
                continue
            overlap = len(topic_toks & ctoks) / (len(topic_toks) or 1)
            scored.append((overlap, {
                "claim_id": c.id,
                "paper_id": pid,
                "doi": doi,
                "paraphrase": c.paraphrase,
                "verbatim_quote": c.verbatim_quote,
            }))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored[:max_size]]


def grounding_report(kg_store: Any) -> dict[str, Any]:
    """Summarise the built graph: papers, claims, edges. Writer + reviewer
    read this to know the evidence base they are grounded to."""
    try:
        paper_ids = kg_store.list_paper_ids()
    except Exception:  # noqa: BLE001
        return {"papers": 0, "claims": 0, "edges": 0}
    claims = 0
    for pid in paper_ids:
        paper = kg_store.read_paper(pid)
        if paper is not None:
            claims += len(paper.nodes.claims)
    edges = 0
    try:
        edges = kg_store.count_edges()
    except Exception:  # noqa: BLE001
        edges = 0
    return {"papers": len(paper_ids), "claims": claims, "edges": edges}


__all__ = [
    "GRAPH_BUILT_MARKER",
    "GraphNotBuiltError",
    "mark_graph_built",
    "is_graph_built",
    "require_graph_built",
    "load_graph_manifest",
    "paper_extractor_prompt",
    "allowed_set_for_topic",
    "grounding_report",
]
