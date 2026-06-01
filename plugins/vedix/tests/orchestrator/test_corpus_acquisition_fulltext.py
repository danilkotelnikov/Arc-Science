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
    led = SourceLedger(["oa_direct", "crossref_fulltext", "europepmc", "europepmc_pdf",
                        "unpaywall", "s2_oa", "core", "springer", "elsevier", "wiley",
                        "preprint", "annas", "scihub_mcp", "crossref_gate"])
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


# --------------------------------------------------------------------------- #
# Publisher channels -- Crossref TDM links + Elsevier / Wiley / Springer
# --------------------------------------------------------------------------- #


def test_publisher_sources_marked_with_keys():
    pipe = _pipe(elsevier_api_key="e", wiley_tdm_token="w", springer_api_key="s")
    rep = pipe.source_ledger.report()["per_source"]
    for s in ("crossref_fulltext", "elsevier", "wiley", "springer"):
        assert rep[s]["tool_discovered"] is True


def test_publisher_apis_not_discovered_without_keys():
    rep = _pipe().source_ledger.report()["per_source"]
    assert rep["elsevier"]["tool_discovered"] is False
    assert rep["wiley"]["tool_discovered"] is False
    # Crossref full-text links need no key -- always available.
    assert rep["crossref_fulltext"]["tool_discovered"] is True


def test_crossref_fulltext_urls_prefers_pdf_over_xml():
    def handler(req):
        return httpx.Response(200, json={"message": {"link": [
            {"URL": "https://pub.example/full.xml", "content-type": "application/xml",
             "intended-application": "text-mining"},
            {"URL": "https://pub.example/full.pdf", "content-type": "application/pdf",
             "intended-application": "text-mining"},
        ]}})
    urls = _run_with_transport(_pipe(), "_crossref_fulltext_urls",
                               httpx.MockTransport(handler), "10.1126/science.x")
    assert urls and urls[0] == "https://pub.example/full.pdf"


def test_crossref_fulltext_urls_empty_when_no_links():
    def handler(req):
        return httpx.Response(200, json={"message": {}})
    urls = _run_with_transport(_pipe(), "_crossref_fulltext_urls",
                               httpx.MockTransport(handler), "10.1/x")
    assert urls == []


def test_elsevier_request_has_auth_header():
    req = _pipe(elsevier_api_key="KEY")._elsevier_request("10.1016/x")
    assert req is not None
    url, hdr = req
    assert "api.elsevier.com" in url and hdr["X-ELS-APIKey"] == "KEY"


def test_wiley_request_has_token_header():
    req = _pipe(wiley_tdm_token="TOK")._wiley_request("10.1002/x")
    assert req is not None
    url, hdr = req
    assert "api.wiley.com" in url and hdr["Wiley-TDM-Client-Token"] == "TOK"


def test_publisher_requests_none_without_keys():
    pipe = _pipe()
    assert pipe._elsevier_request("10.1/x") is None
    assert pipe._wiley_request("10.1/x") is None


def test_springer_oa_url_returns_pdf():
    def handler(req):
        return httpx.Response(200, json={"records": [
            {"url": [{"format": "pdf", "value": "https://link.springer.example/x.pdf"}]}]})
    url = _run_with_transport(_pipe(springer_api_key="k"), "_springer_oa_url",
                              httpx.MockTransport(handler), "10.1007/x")
    assert url == "https://link.springer.example/x.pdf"
