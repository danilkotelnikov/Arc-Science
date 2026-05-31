"""Tests for the grounded-pipeline ordering gate, grounding helpers, the
GraphBuilder ingest seam, and corpus_acquisition substitution.

These encode the fix for the review-run failure: the writer must be blocked
until a byte-verified source graph exists.
"""
from __future__ import annotations

import asyncio
import json
import types
from pathlib import Path

import pytest

from mcp.lib.orchestrator.grounded_pipeline import (
    GraphNotBuiltError,
    allowed_set_for_topic,
    grounding_report,
    is_graph_built,
    mark_graph_built,
    paper_extractor_prompt,
    require_graph_built,
)


# --------------------------------------------------------------------------- #
# The ordering gate
# --------------------------------------------------------------------------- #


def test_require_graph_built_raises_when_absent(tmp_path: Path) -> None:
    with pytest.raises(GraphNotBuiltError):
        require_graph_built(tmp_path)
    assert is_graph_built(tmp_path) is False


def test_mark_then_require_graph_built_round_trips(tmp_path: Path) -> None:
    mark_graph_built(
        tmp_path, papers_extracted=12, papers_failed=3,
        claims_total=84, edges_total=17, kg_wing="vedix_kg__job__abc",
    )
    assert is_graph_built(tmp_path) is True
    manifest = require_graph_built(tmp_path)
    assert manifest["papers_extracted"] == 12
    assert manifest["claims_total"] == 84
    assert manifest["kg_wing"] == "vedix_kg__job__abc"


def test_graph_built_with_zero_papers_is_not_built(tmp_path: Path) -> None:
    """A marker claiming 0 extracted papers must NOT open the gate — an
    empty graph is the same failure as no graph."""
    mark_graph_built(
        tmp_path, papers_extracted=0, papers_failed=9,
        claims_total=0, edges_total=0,
    )
    assert is_graph_built(tmp_path) is False
    with pytest.raises(GraphNotBuiltError):
        require_graph_built(tmp_path)


def test_paper_extractor_prompt_carries_the_byte_verification_rules() -> None:
    p = paper_extractor_prompt(
        paper_id="smith2025", doi="10.1/x", title="A paper",
        raw_text="The melting point was 412 K.", raw_text_path="raw/smith2025.txt",
    )
    assert "verbatim_quote" in p
    assert "quote_byte_range" in p
    assert "contiguous substring" in p.lower()
    assert "The melting point was 412 K." in p  # raw text embedded


# --------------------------------------------------------------------------- #
# Writer grounding — allowed-set from a fake KG
# --------------------------------------------------------------------------- #


def _fake_claim(cid: str, paraphrase: str, quote: str):
    return types.SimpleNamespace(id=cid, paraphrase=paraphrase, verbatim_quote=quote)


def _fake_paper(pid: str, doi: str, claims):
    nodes = types.SimpleNamespace(claims=claims)
    return types.SimpleNamespace(doi=doi, nodes=nodes)


class _FakeKG:
    def __init__(self, papers):
        self._papers = papers  # dict pid -> paper

    def list_paper_ids(self):
        return list(self._papers.keys())

    def read_paper(self, pid):
        return self._papers.get(pid)

    def count_edges(self):
        return 5


def test_allowed_set_ranks_topic_relevant_claims_first() -> None:
    kg = _FakeKG({
        "p1": _fake_paper("p1", "10.1/a", [
            _fake_claim("p1.c1", "Graphene FET immunosensors detect troponin at femtomolar levels",
                        "the graphene FET detected cardiac troponin at 1 fM"),
        ]),
        "p2": _fake_paper("p2", "10.1/b", [
            _fake_claim("p2.c1", "AlphaFold-Multimer predicts antibody-antigen complexes",
                        "AlphaFold-Multimer predicted the Fab-antigen interface"),
        ]),
    })
    out = allowed_set_for_topic(kg, topic="graphene field-effect transistor immunosensor troponin", max_size=10)
    assert out  # non-empty
    # the FET/troponin claim should rank first for that topic
    assert out[0]["claim_id"] == "p1.c1"
    assert out[0]["doi"] == "10.1/a"
    assert "verbatim_quote" in out[0]


def test_allowed_set_empty_kg_returns_empty() -> None:
    assert allowed_set_for_topic(_FakeKG({}), topic="anything") == []


def test_grounding_report_counts_papers_and_claims() -> None:
    kg = _FakeKG({
        "p1": _fake_paper("p1", "10.1/a", [_fake_claim("p1.c1", "x", "y"), _fake_claim("p1.c2", "a", "b")]),
        "p2": _fake_paper("p2", "10.1/b", [_fake_claim("p2.c1", "m", "n")]),
    })
    rep = grounding_report(kg)
    assert rep["papers"] == 2
    assert rep["claims"] == 3
    assert rep["edges"] == 5


# --------------------------------------------------------------------------- #
# corpus_acquisition substitution
# --------------------------------------------------------------------------- #


def test_acquire_with_substitution_skips_unobtainable_and_meets_target(tmp_path: Path) -> None:
    """Candidates 2 and 4 are unobtainable; the cascade substitutes them and
    still reaches target_n=3 from a 6-candidate pool."""
    from mcp.lib.orchestrator.corpus_acquisition import (
        CorpusAcquisitionPipeline, AcquisitionResult,
    )
    from mcp.lib.orchestrator.source_accounting import SourceLedger

    pipe = CorpusAcquisitionPipeline(
        crossref_email="x@example.com",
        source_ledger=SourceLedger(["oa_direct", "annas", "scihub_mcp", "crossref_gate"]),
        corpus_root=tmp_path,
    )

    obtainable = {"10.1/a", "10.1/c", "10.1/e", "10.1/f"}

    async def fake_acquire_one(*, doi, title, year, discipline, lang,
                               venue=None, use_annas_fallback=False,
                               use_scihub_fallback=False, skip_doi_gate=False):
        if doi in obtainable:
            r = AcquisitionResult(success=True, doi=doi, title=title, discipline=discipline)
            r.text_path = tmp_path / f"{doi.replace('/', '_')}.txt"
            r.source = "oa_direct"
            return r
        return AcquisitionResult(success=False, doi=doi, title=title,
                                 discipline=discipline, failure_reason="no_fulltext")

    pipe.acquire_one = fake_acquire_one  # type: ignore[assignment]

    candidates = [{"doi": f"10.1/{c}", "title": c, "year": 2025} for c in "abcdef"]
    out = asyncio.run(pipe.acquire_with_substitution(
        candidates=candidates, target_n=3, discipline="biology",
    ))
    assert out["target_met"] is True
    assert out["obtained_n"] == 3
    # it stopped at 3 (a, c, e) without needing f
    got = {r["doi"] for r in out["obtained"]}
    assert got == {"10.1/a", "10.1/c", "10.1/e"}
    # b and d were substituted out
    subs = {s["doi"] for s in out["substituted_out"]}
    assert "10.1/b" in subs and "10.1/d" in subs


def test_acquire_with_substitution_reports_shortfall(tmp_path: Path) -> None:
    """When the pool cannot meet target_n, target_met is False and the
    obtained set is whatever was reachable (no fabrication)."""
    from mcp.lib.orchestrator.corpus_acquisition import (
        CorpusAcquisitionPipeline, AcquisitionResult,
    )
    from mcp.lib.orchestrator.source_accounting import SourceLedger

    pipe = CorpusAcquisitionPipeline(
        crossref_email="x@example.com",
        source_ledger=SourceLedger(["oa_direct", "annas", "scihub_mcp", "crossref_gate"]),
        corpus_root=tmp_path,
    )

    async def fake_acquire_one(*, doi, title, **kw):
        if doi == "10.1/a":
            r = AcquisitionResult(success=True, doi=doi, title=title, discipline="biology")
            r.text_path = tmp_path / "a.txt"
            return r
        return AcquisitionResult(success=False, doi=doi, title=title,
                                 discipline="biology", failure_reason="no_fulltext")

    pipe.acquire_one = fake_acquire_one  # type: ignore[assignment]
    candidates = [{"doi": f"10.1/{c}", "title": c, "year": 2025} for c in "abc"]
    out = asyncio.run(pipe.acquire_with_substitution(
        candidates=candidates, target_n=3, discipline="biology",
    ))
    assert out["target_met"] is False
    assert out["obtained_n"] == 1


# --------------------------------------------------------------------------- #
# GraphBuilder ingest seam (byte-verified) — exercises the real validator
# --------------------------------------------------------------------------- #


def test_graphbuilder_ingest_fragment_byte_verifies(tmp_path: Path) -> None:
    pytest.importorskip("yaml")
    from mcp.lib.orchestrator.sgca.graph_builder import GraphBuilder, ExtractionFailure
    from mcp.lib.orchestrator.sgca.kg_store import KGStore, Tier

    raw = "The catalyst achieved 92 percent yield under mild conditions."
    raw_path = tmp_path / "paper1.txt"
    raw_path.write_bytes(raw.encode("utf-8"))

    quote = "92 percent yield"
    start = raw.encode("utf-8").index(quote.encode("utf-8"))
    end = start + len(quote.encode("utf-8"))

    good_yaml = f"""
paper_id: paper1
doi: 10.1/test
title: A test paper
year: 2025
authors:
  - {{id: "author:smith", name: "J. Smith"}}
venue: Test Journal
language: en
license: cc-by
raw_pointer:
  text: {raw_path}
  byte_len: {len(raw.encode('utf-8'))}
nodes:
  claims:
    - id: paper1.claim01
      type: empirical
      paraphrase: The catalyst gave high yield.
      verbatim_quote: "{quote}"
      quote_byte_range: [{start}, {end}]
      page: 1
      section: Results
      confidence: 0.9
      hedge: false
      provenance: {{extractor_model: paper-extractor}}
  methods: []
  results: []
  limitations: []
  entities: []
edges:
  - {{from: "paper:paper1", to: "paper1.claim01", kind: contains}}
"""
    store = KGStore(Tier.JOB, scope_id="test_ingest_ok")
    gb = GraphBuilder(store=store)
    paper = {"id": "paper1", "doi": "10.1/test", "title": "A test paper",
             "raw_text_path": str(raw_path)}
    frag = gb.ingest_fragment(good_yaml, paper)
    assert frag.paper_id == "paper1"
    assert frag.nodes.claims[0].verbatim_quote == quote

    # A fabricated quote (not a substring of raw) must be REJECTED.
    bad_yaml = good_yaml.replace(
        'verbatim_quote: "92 percent yield"',
        'verbatim_quote: "99 percent yield"',
    )
    store2 = KGStore(Tier.JOB, scope_id="test_ingest_bad")
    gb2 = GraphBuilder(store=store2)
    with pytest.raises(ExtractionFailure):
        gb2.ingest_fragment(bad_yaml, paper)
