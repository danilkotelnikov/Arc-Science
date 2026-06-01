"""Tests for the full-text hardening of corpus_acquisition: text
normalisation, the structural full-text gate, and the OA-discovery channels
(Unpaywall / Semantic Scholar / preprint-by-title) that find legal full text
for paywalled DOIs.
"""
from __future__ import annotations

import asyncio

import httpx

from mcp.lib.orchestrator.corpus_acquisition import (
    CorpusAcquisitionPipeline,
    normalize_fulltext,
    looks_like_fulltext,
)
from mcp.lib.orchestrator.source_accounting import SourceLedger


def _pipe(**kw) -> CorpusAcquisitionPipeline:
    led = SourceLedger(["oa_direct", "europepmc", "europepmc_pdf", "unpaywall",
                        "s2_oa", "core", "preprint", "annas", "scihub_mcp",
                        "crossref_gate"])
    return CorpusAcquisitionPipeline(crossref_email="x@example.com",
                                     source_ledger=led, **kw)


# --------------------------------------------------------------------------- #
# normalisation
# --------------------------------------------------------------------------- #


def test_normalize_fulltext_fixes_ligatures_dashes_and_dehyphenates():
    raw = "The anti-\nbody showed ﬁve-fold ﬂow with high aﬃnity at 10–20 nM.\n\nNext."
    n = normalize_fulltext(raw)
    assert "antibody" in n            # de-hyphenated across the line break
    assert "five-fold" in n           # ligature fi
    assert "flow" in n                # ligature fl
    assert "affinity" in n            # ligature ffi
    assert "10-20" in n               # en-dash unified
    assert "\n\n" in n                # paragraph boundary kept


def test_normalize_fulltext_collapses_intra_paragraph_newlines():
    raw = "one line\ntwo line\nthree line"
    assert normalize_fulltext(raw) == "one line two line three line"


# --------------------------------------------------------------------------- #
# structural full-text gate
# --------------------------------------------------------------------------- #


def test_gate_rejects_abstract_only():
    ok, why = looks_like_fulltext("word " * 80, min_words=500)
    assert ok is False and "too_short" in why


def test_gate_accepts_structured_body():
    body = ("Introduction " + "word " * 600
            + " Methods Results Discussion References "
            + "Smith et al 2021 2022 2023 2024 2019 2018 2017 2016")
    ok, why = looks_like_fulltext(body, min_words=500)
    assert ok is True and why.startswith("ok_")


def test_gate_rejects_one_page_pdf():
    ok, why = looks_like_fulltext("word " * 2000, min_words=500, pdf_pages=1)
    assert ok is False and "pdf_pages" in why


def test_gate_long_text_without_headers_still_passes():
    ok, _ = looks_like_fulltext("word " * 1600, min_words=500)
    assert ok is True


# --------------------------------------------------------------------------- #
# OA-discovery channels wired + always-available sources marked
# --------------------------------------------------------------------------- #


def test_oa_discovery_sources_marked_discovered():
    pipe = _pipe(core_api_key="key")
    rep = pipe.source_ledger.report()["per_source"]
    for s in ("europepmc_pdf", "unpaywall", "s2_oa", "preprint", "core"):
        assert rep[s]["tool_discovered"] is True


def test_core_not_discovered_without_key():
    pipe = _pipe()
    rep = pipe.source_ledger.report()["per_source"]
    assert rep["core"]["tool_discovered"] is False


def _run_with_transport(pipe, method_name, transport, *args, **kw):
    async def go():
        async with httpx.AsyncClient(transport=transport) as client:
            return await getattr(pipe, method_name)(*args, client=client, **kw)
    return asyncio.run(go())


def test_unpaywall_returns_pdf_url():
    def handler(req):
        return httpx.Response(200, json={
            "best_oa_location": {"url_for_pdf": "https://repo.example/x.pdf"}})
    url = _run_with_transport(_pipe(), "_unpaywall_pdf_url",
                              httpx.MockTransport(handler), "10.1/x")
    assert url == "https://repo.example/x.pdf"


def test_unpaywall_none_when_closed():
    def handler(req):
        return httpx.Response(200, json={"best_oa_location": None, "oa_locations": []})
    url = _run_with_transport(_pipe(), "_unpaywall_pdf_url",
                              httpx.MockTransport(handler), "10.1/x")
    assert url is None


def test_s2_open_access_pdf_url():
    def handler(req):
        return httpx.Response(200, json={"openAccessPdf": {"url": "https://s2.example/y.pdf"}})
    url = _run_with_transport(_pipe(), "_s2_oa_pdf_url",
                              httpx.MockTransport(handler), "10.1/y")
    assert url == "https://s2.example/y.pdf"


def test_preprint_by_title_matches_arxiv_entry():
    atom = (
        '<feed><entry>'
        '<title>De novo antibody design with diffusion models</title>'
        '<id>http://arxiv.org/abs/2401.00001v1</id>'
        '<link title="pdf" href="http://arxiv.org/pdf/2401.00001v1"/>'
        '</entry></feed>'
    )
    def handler(req):
        return httpx.Response(200, text=atom)
    url = _run_with_transport(_pipe(), "_preprint_pdf_url_by_title",
                              httpx.MockTransport(handler),
                              "De novo antibody design with diffusion models", 2024)
    assert url == "http://arxiv.org/pdf/2401.00001v1"


def test_preprint_by_title_rejects_mismatch():
    atom = (
        '<feed><entry><title>An unrelated paper about something else</title>'
        '<id>http://arxiv.org/abs/2401.99999v1</id>'
        '<link title="pdf" href="http://arxiv.org/pdf/2401.99999v1"/>'
        '</entry></feed>'
    )
    def handler(req):
        return httpx.Response(200, text=atom)
    url = _run_with_transport(_pipe(), "_preprint_pdf_url_by_title",
                              httpx.MockTransport(handler),
                              "De novo antibody design with diffusion models", 2024)
    assert url is None
