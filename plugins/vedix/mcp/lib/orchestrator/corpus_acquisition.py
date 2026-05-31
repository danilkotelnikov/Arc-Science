"""Unified literature acquisition pipeline.

Consolidates the standalone ``scripts/scrape_oa.py`` and
``scripts/scrape_scihub.py`` work into a single orchestrator-callable
module that the **literature-searcher** + **citator/reviewer** agents
plug into.

Cascades
--------
1. **DOI gate** (mandatory) -- :func:`cross_validator.stage1_doi_gate`
   resolves the DOI against Crossref / DataCite and runs a token-sort
   title fuzzy match (>= 0.85). Failures short-circuit the cascade and
   are recorded in the SourceLedger as ``crossref_gate`` failures.

2. **OA-direct** -- queries OpenAlex for the single work record, walks
   ``best_oa_location.pdf_url`` then every ``oa_locations[]`` entry
   then every ``locations[]`` entry filtered to known preprint /
   repository hosts (arxiv, biorxiv, pmc, osti, hal, escholarship,
   eprints, ...). Browser-headers download with magic-byte validation.

3. **Sci-Hub MCP** (gentle, opt-in) -- when ``use_scihub_fallback=True``
   AND the OA path returned no PDF, dispatches ``search_scihub_by_doi``
   + ``download_scihub_pdf`` through the patched Sci-Hub MCP server at
   ``~/.vedix/external/Sci-Hub-MCP-Server/`` with ``pace_seconds``
   wall-clock spacing between papers.

Cross-integrations
------------------
- :class:`source_accounting.SourceLedger` -- per-source provenance
  (configured / attempted / successful / failed / rate_limit_hits) with
  ``oa_direct``, ``scihub_mcp``, ``crossref_gate`` as the source keys.

- :class:`sgca.kg_store.KGStore` (optional) -- writes a skeleton
  :class:`sgca.schema.KGFragment` for every successfully acquired
  paper: paper metadata + license + raw_pointer to the on-disk PDF.
  Claims / methods / results are filled in downstream by
  paper-extractor and claim-verifier agents.

- :class:`provenance_ledger.ProvenanceLedger` (optional) -- records one
  ledger entry per acquisition event so the AI-disclosure section can
  cite which sources delivered which paper.

Usage from the orchestrator
---------------------------
::

    from .corpus_acquisition import CorpusAcquisitionPipeline
    from .source_accounting import SourceLedger
    from .sgca.kg_store import KGStore, Tier

    pipeline = CorpusAcquisitionPipeline(
        crossref_email="researcher@example.com",
        source_ledger=SourceLedger(["oa_direct", "scihub_mcp", "crossref_gate"]),
        kg_store=KGStore(Tier.JOB, scope_id=job_id),
        corpus_root=Path("~/.vedix/corpus").expanduser(),
        pace_seconds=25.0,
    )
    result = await pipeline.acquire_one(
        doi="10.1038/s41586-024-07041-8",
        title="Some paper title",
        year=2024,
        discipline="chemistry",
        venue="Nature",
        use_scihub_fallback=True,
    )

The peer-reviewing pipeline (:mod:`adversarial_review` + ``reviewer``
agent) can interrogate the same SourceLedger + KGStore to confirm that
every cited paper has on-disk full-text and a valid DOI-gate result --
no claim can be reviewed against a paper Vedix never actually
acquired.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import httpx

from .cross_validator import normalize_doi, stage1_doi_gate
from .source_accounting import SourceLedger


# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------

USER_AGENT_BROWSER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
DEFAULT_BROWSER_HEADERS = {
    "User-Agent": USER_AGENT_BROWSER,
    "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Known legitimate-OA hosts. When walking the OpenAlex ``locations[]``
# list (not just oa_locations), only entries whose pdf_url contains
# one of these substrings are kept -- this keeps us out of paywalled
# publisher CDNs (ACS, APS) that 403 anonymous clients.
LEGITIMATE_OA_HOSTS = (
    "arxiv.org", "biorxiv.org", "medrxiv.org", "chemrxiv.org",
    "osti.gov", "pmc.ncbi.nlm.nih.gov", "europepmc.org",
    "hal.science", "hal.archives-ouvertes.fr",
    "tspace.library.utoronto.ca", "escholarship.org",
    "eprints.", "research-explorer", "ssoar.info",
    "doi.org/10.7554/elife",  # eLife CDN fallback
    "nature.com",              # hybrid-OA Nature serves cc-by anonymously
)


def _safe_filename_stem(doi: str) -> str:
    """Turn a DOI into a filesystem-safe stem (no slashes etc.)."""
    return re.sub(r"[^a-zA-Z0-9._-]", "_", doi)


def _is_legitimate_oa_url(url: str) -> bool:
    """Return True if ``url`` matches a known legitimate-OA host."""
    return any(host in url for host in LEGITIMATE_OA_HOSTS)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class AcquisitionResult:
    """Outcome of one ``acquire_one`` call."""

    success: bool
    doi: str
    title: str
    discipline: str
    license: str = ""
    pdf_path: Optional[Path] = None
    text_path: Optional[Path] = None
    source: Optional[str] = None  # "oa_direct" | "scihub_mcp"
    pdf_url_used: Optional[str] = None
    pdf_host: Optional[str] = None
    failure_reason: Optional[str] = None
    gate_result: dict[str, Any] = field(default_factory=dict)
    bytes_written: int = 0
    extracted_chars: int = 0

    def as_dict(self) -> dict[str, Any]:
        d = self.__dict__.copy()
        if isinstance(d.get("pdf_path"), Path):
            d["pdf_path"] = str(d["pdf_path"])
        if isinstance(d.get("text_path"), Path):
            d["text_path"] = str(d["text_path"])
        return d


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


class CorpusAcquisitionPipeline:
    """Unified OA-first + Sci-Hub-fallback acquisition pipeline.

    Args:
        crossref_email: Email forwarded to Crossref's polite pool for the
            DOI gate. Required.
        source_ledger: A :class:`SourceLedger` configured with at least
            ``["oa_direct", "scihub_mcp", "crossref_gate"]`` sources.
        corpus_root: On-disk corpus root (default ``~/.vedix/corpus``).
            Per-discipline outputs land in
            ``<root>/<discipline>/<lang>/{pdf,text,downloaded.jsonl}``.
        pace_seconds: Wall-clock pause between successful Sci-Hub
            downloads. Default 25 -- a gentle pattern that mirrors
            careful human browsing.
        scihub_mcp_path: Path to the Sci-Hub MCP server entry point
            (``sci_hub_server.py``). Pass ``None`` to disable the
            Sci-Hub fallback even when callers ask for it.
        kg_store: Optional :class:`sgca.kg_store.KGStore` to receive a
            paper-skeleton KGFragment per success.
        provenance_ledger: Optional :class:`provenance_ledger.ProvenanceLedger`
            to record acquisition events.
        log: Logger; one is created if omitted.
    """

    def __init__(
        self,
        *,
        crossref_email: str,
        source_ledger: SourceLedger,
        corpus_root: Optional[Path] = None,
        pace_seconds: float = 25.0,
        scihub_mcp_path: Optional[Path] = None,
        annas_secret_key: Optional[str] = None,
        annas_base_url: str = "https://annas-archive.org",
        kg_store: Any = None,  # KGStore -- typed loosely so tests can pass None
        provenance_ledger: Any = None,  # ProvenanceLedger
        log: Optional[logging.Logger] = None,
    ) -> None:
        self.crossref_email = crossref_email
        self.source_ledger = source_ledger
        self.corpus_root = (
            corpus_root or Path(os.path.expanduser("~/.vedix/corpus"))
        )
        self.pace_seconds = pace_seconds
        self.scihub_mcp_path = scihub_mcp_path
        self.annas_secret_key = (annas_secret_key or "").strip() or None
        self.annas_base_url = (annas_base_url or "https://annas-archive.org").rstrip("/")
        if not self.annas_base_url.startswith(("http://", "https://")):
            self.annas_base_url = f"https://{self.annas_base_url}"
        self.kg_store = kg_store
        self.provenance_ledger = provenance_ledger
        self.log = log or logging.getLogger(__name__)

        # Mark configured sources as tool_discovered so the report says
        # they were available. Europe PMC + OA-direct + the Crossref gate
        # need no key and are always available.
        for src in ("oa_direct", "crossref_gate", "europepmc"):
            self.source_ledger.mark_tool_discovered(src)
        if self.scihub_mcp_path is not None:
            self.source_ledger.mark_tool_discovered("scihub_mcp")
        if self.annas_secret_key is not None:
            self.source_ledger.mark_tool_discovered("annas")

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    async def acquire_one(
        self,
        *,
        doi: str,
        title: str,
        year: int,
        discipline: str,
        venue: Optional[str] = None,
        lang: str = "en",
        use_annas_fallback: bool = False,
        use_scihub_fallback: bool = False,
        skip_doi_gate: bool = False,
    ) -> AcquisitionResult:
        """Acquire a single paper through the cascade.

        Cascade order (gentle, substituting): DOI gate -> OA-direct ->
        Anna's Archive (if ``use_annas_fallback`` + secret key) ->
        Sci-Hub MCP (if ``use_scihub_fallback`` + server path). Each
        paywall channel is paced by ``pace_seconds`` so mirrors are
        never hammered.

        ``skip_doi_gate=True`` is for test fixtures only; production
        callers should always run the gate.
        """
        doi_norm = normalize_doi(doi)
        out_dir = self._out_dir(discipline, lang)
        pdf_dir = out_dir / "pdf"
        text_dir = out_dir / "text"
        pdf_dir.mkdir(parents=True, exist_ok=True)
        text_dir.mkdir(parents=True, exist_ok=True)

        dest_pdf = pdf_dir / f"{_safe_filename_stem(doi_norm)}.pdf"
        dest_txt = text_dir / f"{_safe_filename_stem(doi_norm)}.txt"

        result = AcquisitionResult(
            success=False, doi=doi_norm, title=title, discipline=discipline,
        )

        # Cache-hit short-circuit. If the PDF is already on disk and is
        # a valid PDF, treat as success without re-downloading. Useful
        # when the literature-searcher feeds the same DOI twice.
        if dest_pdf.exists() and dest_pdf.stat().st_size > 1024 \
                and dest_pdf.read_bytes()[:5] == b"%PDF-":
            result.success = True
            result.source = "cache"
            result.pdf_path = dest_pdf
            result.text_path = dest_txt if dest_txt.exists() else None
            result.bytes_written = dest_pdf.stat().st_size
            return result

        # Stage 1: DOI gate
        if not skip_doi_gate:
            gate = stage1_doi_gate(
                {"doi": doi_norm}, harvest_title=title,
                crossref_email=self.crossref_email,
            )
            result.gate_result = gate
            if not gate.get("passed"):
                self.source_ledger.record_call(
                    "crossref_gate", success=False, http_status=None,
                )
                result.failure_reason = f"gate_{gate.get('reason', 'unknown')}"
                return result
            self.source_ledger.record_call(
                "crossref_gate", success=True, records_added=1,
            )

        # Stage 1.5: Europe PMC full text (text-direct). Best channel for
        # OA biomedical papers -- OpenAlex often exposes only a PMC landing
        # page, so the PDF cascade below misses them. This yields clean
        # JATS body text with no PDF round-trip and needs no pacing.
        epmc_chars = await self._europepmc_fulltext(doi_norm, dest_txt)
        if epmc_chars >= 1000:
            self.source_ledger.record_call(
                "europepmc", success=True, records_added=1,
            )
            result.success = True
            result.source = "europepmc"
            result.license = "oa (europepmc)"
            result.text_path = dest_txt
            result.extracted_chars = epmc_chars
            self._record_acquisition_artifacts(
                result=result, year=year, venue=venue, lang=lang,
            )
            self._append_manifest(result, out_dir, year=year, venue=venue)
            return result
        self.source_ledger.record_call(
            "europepmc", success=False, http_status=None,
        )

        # Stage 2: OA-direct
        async with httpx.AsyncClient(
            timeout=120, follow_redirects=True,
            headers={"User-Agent": f"vedix/3.0 (mailto:{self.crossref_email})"},
        ) as client:
            urls = await self._oa_resolve_pdf_urls(doi_norm, client=client)
            for url, host, license_ in urls:
                if await self._download_pdf(url, dest_pdf, client=client):
                    self.source_ledger.record_call(
                        "oa_direct", success=True, records_added=1,
                    )
                    result.success = True
                    result.source = "oa_direct"
                    result.pdf_url_used = url
                    result.pdf_host = host
                    result.license = license_ or ""
                    result.pdf_path = dest_pdf
                    result.bytes_written = dest_pdf.stat().st_size
                    break

        # Stage 3: Anna's Archive (gentle, opt-in) -- paywall channel #1
        if not result.success and use_annas_fallback and self.annas_secret_key:
            annas_ok = await self._annas_acquire(doi_norm, dest_pdf)
            if annas_ok:
                self.source_ledger.record_call(
                    "annas", success=True, records_added=1,
                )
                result.success = True
                result.source = "annas"
                result.license = "annas-mirror"
                result.pdf_path = dest_pdf
                result.bytes_written = dest_pdf.stat().st_size
                await asyncio.sleep(self.pace_seconds)
            else:
                self.source_ledger.record_call(
                    "annas", success=False, http_status=None,
                )

        # Stage 4: Sci-Hub MCP (gentle, opt-in) -- paywall channel #2
        if not result.success and use_scihub_fallback and self.scihub_mcp_path:
            scihub_ok = await self._scihub_acquire(doi_norm, dest_pdf)
            if scihub_ok:
                self.source_ledger.record_call(
                    "scihub_mcp", success=True, records_added=1,
                )
                result.success = True
                result.source = "scihub_mcp"
                result.license = "scihub-mirror"
                result.pdf_path = dest_pdf
                result.bytes_written = dest_pdf.stat().st_size
                await asyncio.sleep(self.pace_seconds)
            else:
                self.source_ledger.record_call(
                    "scihub_mcp", success=False, http_status=None,
                )

        if not result.success:
            self.source_ledger.record_call(
                "oa_direct", success=False, http_status=None,
            )
            result.failure_reason = result.failure_reason or "no_pdf_found"
            return result

        # Post-acquisition: text extraction
        if dest_pdf.exists():
            extracted = self._extract_text(dest_pdf, dest_txt)
            if extracted >= 0:
                result.text_path = dest_txt
                result.extracted_chars = extracted

        # Post-acquisition: KG fragment + provenance
        self._record_acquisition_artifacts(
            result=result, year=year, venue=venue, lang=lang,
        )
        self._append_manifest(result, out_dir, year=year, venue=venue)

        return result

    async def acquire_batch(
        self,
        *,
        candidates: list[dict[str, Any]],
        discipline: str,
        lang: str = "en",
        use_scihub_fallback: bool = False,
    ) -> dict[str, Any]:
        """Acquire many papers in one cascade.

        ``candidates`` is a list of dicts each with at minimum
        ``doi``, ``title``, ``year`` (e.g. the output of the
        literature-searcher's OpenAlex query).
        """
        results: list[AcquisitionResult] = []
        for c in candidates:
            r = await self.acquire_one(
                doi=c["doi"], title=c.get("title", ""),
                year=int(c.get("year") or 0),
                discipline=discipline, lang=lang,
                venue=c.get("venue") or c.get("source_journal"),
                use_scihub_fallback=use_scihub_fallback,
            )
            results.append(r)

        ok = sum(1 for r in results if r.success)
        return {
            "discipline": discipline,
            "lang": lang,
            "candidate_count": len(candidates),
            "success_count": ok,
            "failure_count": len(candidates) - ok,
            "results": [r.as_dict() for r in results],
            "source_ledger": self.source_ledger.report(),
        }

    async def acquire_with_substitution(
        self,
        *,
        candidates: list[dict[str, Any]],
        target_n: int,
        discipline: str,
        lang: str = "en",
        use_annas_fallback: bool = True,
        use_scihub_fallback: bool = True,
    ) -> dict[str, Any]:
        """Acquire full text for ``target_n`` papers, substituting failures.

        Walk the ranked ``candidates`` pool (best first). For each, run
        the full cascade (DOI gate -> OA -> Anna's -> Sci-Hub). Keep the
        ones that yield a verified full-text PDF; when a candidate can't
        be obtained from ANY channel, skip it and pull the next candidate
        from the pool instead -- i.e. an unobtainable source is
        substituted by an obtainable one. Stop once ``target_n`` grounded
        papers are in hand or the pool is exhausted.

        Returns the obtained set (with on-disk pdf/text paths), the
        substituted-out set (with failure reasons), and whether the
        target was met. This is what makes "the writer only sees sources
        we actually hold the full text for" true.
        """
        obtained: list[AcquisitionResult] = []
        substituted: list[dict[str, Any]] = []

        for c in candidates:
            if len(obtained) >= target_n:
                break
            doi = (c.get("doi") or "").strip()
            if not doi:
                substituted.append({"title": c.get("title", ""), "reason": "no_doi"})
                continue
            r = await self.acquire_one(
                doi=doi, title=c.get("title", ""),
                year=int(c.get("year") or 0),
                discipline=discipline, lang=lang,
                venue=c.get("venue") or c.get("source_journal"),
                use_annas_fallback=use_annas_fallback,
                use_scihub_fallback=use_scihub_fallback,
            )
            if r.success and r.text_path is not None:
                obtained.append(r)
            else:
                substituted.append({
                    "doi": doi, "title": c.get("title", ""),
                    "reason": r.failure_reason or "no_fulltext",
                })

        return {
            "discipline": discipline,
            "lang": lang,
            "target_n": target_n,
            "obtained_n": len(obtained),
            "target_met": len(obtained) >= target_n,
            "pool_size": len(candidates),
            "obtained": [r.as_dict() for r in obtained],
            "substituted_out": substituted,
            "source_ledger": self.source_ledger.report(),
        }

    # ------------------------------------------------------------------ #
    # OA cascade -- internal
    # ------------------------------------------------------------------ #

    async def _oa_resolve_pdf_urls(
        self, doi: str, *, client: httpx.AsyncClient,
    ) -> list[tuple[str, str, str]]:
        """Return a list of ``(pdf_url, host, license)`` triples from
        the OpenAlex single-work record for ``doi``.

        Walks ``best_oa_location.pdf_url`` first, then ``oa_locations[]``,
        then every ``locations[]`` entry filtered to known legitimate-OA
        hosts. Duplicates are dropped.
        """
        try:
            r = await client.get(
                f"https://api.openalex.org/works/doi:{doi}",
                params={"mailto": self.crossref_email},
            )
            if r.status_code != 200:
                return []
            data = r.json()
        except Exception:  # noqa: BLE001
            return []

        out: list[tuple[str, str, str]] = []
        seen: set[str] = set()

        def _maybe_add(loc: dict[str, Any], gate_to_legit_hosts: bool) -> None:
            url = loc.get("pdf_url")
            if not url or url in seen:
                return
            if gate_to_legit_hosts and not _is_legitimate_oa_url(url):
                return
            seen.add(url)
            host = (loc.get("source") or {}).get("display_name") or ""
            lic = loc.get("license") or ""
            out.append((url, host, lic))

        best = data.get("best_oa_location") or {}
        _maybe_add(best, gate_to_legit_hosts=False)
        for loc in (data.get("oa_locations") or []):
            _maybe_add(loc, gate_to_legit_hosts=False)
        for loc in (data.get("locations") or []):
            _maybe_add(loc, gate_to_legit_hosts=True)

        return out

    # ------------------------------------------------------------------ #
    # Anna's Archive cascade -- internal (scidb -> fast_download -> stream)
    # ------------------------------------------------------------------ #

    async def _annas_acquire(self, doi: str, dest: Path) -> bool:
        """Resolve a DOI to a full-text PDF via Anna's Archive, gently.

        Pattern (proven in scripts/scrape_nature.py): hit the canonical
        ``/scidb/<doi>`` resolver to get the md5, then call
        ``/dyn/api/fast_download.json?md5=<md5>&key=<secret>`` for a
        one-shot signed URL, then stream + validate %PDF-. Includes a
        DOI-in-signed-URL sanity check so a wrong-md5 hit (a known Anna's
        bug for newly-added papers) is rejected rather than saved.
        """
        if not self.annas_secret_key:
            return False
        base = self.annas_base_url
        try:
            async with httpx.AsyncClient(
                timeout=120, follow_redirects=True,
                headers={"User-Agent": USER_AGENT_BROWSER},
            ) as client:
                # Step 1: scidb DOI resolver -> md5
                md5: Optional[str] = None
                try:
                    r = await client.get(f"{base}/scidb/{doi}")
                    if r.status_code == 200:
                        m = re.search(r'href="/md5/([a-f0-9]{32})"', r.text)
                        if m:
                            md5 = m.group(1)
                except Exception as exc:  # noqa: BLE001
                    self.log.debug("annas scidb failed for %s: %s", doi, exc)
                if not md5:
                    # Fallback: search endpoint with title-free DOI query
                    try:
                        r = await client.get(
                            f"{base}/search",
                            params={"q": doi, "content": "journal_article", "ext": "pdf"},
                        )
                        if r.status_code == 200:
                            m = re.search(r'href="/md5/([a-f0-9]{32})"', r.text)
                            if m:
                                md5 = m.group(1)
                    except Exception:  # noqa: BLE001
                        pass
                if not md5:
                    return False

                # Step 2: fast_download.json -> signed URL
                try:
                    r = await client.get(
                        f"{base}/dyn/api/fast_download.json",
                        params={"md5": md5, "key": self.annas_secret_key},
                    )
                    if r.status_code != 200:
                        return False
                    data = r.json()
                except Exception as exc:  # noqa: BLE001
                    self.log.debug("annas fast_download failed: %s", exc)
                    return False
                signed = data.get("download_url") if isinstance(data, dict) else None
                if not signed or not isinstance(signed, str):
                    return False

                # Step 2.5: DOI-in-URL sanity check (reject wrong-md5 hits)
                um = re.search(r"/(10\.\d{4,9}/[^/.~]+(?:[.-][^/.~]+)*)\.pdf~", signed)
                if um and um.group(1).lower() != doi.lower():
                    self.log.debug("annas doi mismatch: got %s for %s", um.group(1), doi)
                    return False

                # Step 3: stream + validate
                return await self._download_pdf(signed, dest, client=client)
        except Exception as exc:  # noqa: BLE001
            self.log.debug("annas acquire failed for %s: %s", doi, exc)
            return False

    async def _download_pdf(
        self, url: str, dest: Path, *, client: httpx.AsyncClient,
    ) -> bool:
        """Stream ``url`` to ``dest`` with browser headers; validate magic bytes."""
        if dest.exists():
            dest.unlink()
        try:
            async with client.stream(
                "GET", url, headers=DEFAULT_BROWSER_HEADERS, timeout=120,
            ) as r:
                r.raise_for_status()
                with dest.open("wb") as f:
                    async for chunk in r.aiter_bytes(chunk_size=64_000):
                        f.write(chunk)
        except Exception as exc:  # noqa: BLE001
            self.log.debug("oa download failed: %s", exc)
            if dest.exists():
                dest.unlink()
            return False
        if dest.stat().st_size < 1024:
            dest.unlink()
            return False
        if dest.read_bytes()[:5] != b"%PDF-":
            dest.unlink()
            return False
        return True

    # ------------------------------------------------------------------ #
    # Europe PMC full-text cascade -- internal (text-direct, OA biomedical)
    # ------------------------------------------------------------------ #

    async def _europepmc_fulltext(self, doi: str, dest_txt: Path) -> int:
        """Resolve a DOI to OA full text via Europe PMC, writing plaintext.

        OpenAlex frequently exposes only a PMC *landing page* (no direct
        ``pdf_url``), so OA-direct misses PubMed Central -- the largest OA
        biomedical full-text source. Europe PMC serves the JATS XML full
        text for every OA article it holds. We resolve the DOI to its
        PMCID, fetch ``/PMC/<pmcid>/fullTextXML``, and flatten the JATS
        body to plaintext. Returns the character count, or -1 when the
        article is not OA-available here (the caller then falls through to
        the PDF channels). No API key, generous rate limits, no pacing.
        """
        base = "https://www.ebi.ac.uk/europepmc/webservices/rest"
        try:
            async with httpx.AsyncClient(
                timeout=90, follow_redirects=True,
                headers={"User-Agent": f"vedix/3.0 (mailto:{self.crossref_email})"},
            ) as client:
                r = await client.get(
                    f"{base}/search",
                    params={"query": f'DOI:"{doi}"', "format": "json",
                            "resultType": "lite", "pageSize": 1},
                )
                if r.status_code != 200:
                    return -1
                results = (r.json().get("resultList", {}) or {}).get("result", [])
                if not results:
                    return -1
                rec = results[0]
                pmcid = rec.get("pmcid")
                is_oa = rec.get("isOpenAccess") == "Y" or rec.get("inEPMC") == "Y"
                if not pmcid or not is_oa:
                    return -1
                rx = await client.get(f"{base}/{pmcid}/fullTextXML")
                if rx.status_code != 200 or len(rx.text) < 500:
                    return -1
                text = self._jats_to_text(rx.text)
                if len(text) < 1000:
                    return -1
                dest_txt.write_text(text, encoding="utf-8")
                return len(text)
        except Exception as exc:  # noqa: BLE001
            self.log.debug("europepmc failed for %s: %s", doi, exc)
            return -1

    @staticmethod
    def _jats_to_text(xml_text: str) -> str:
        """Flatten JATS full-text XML to readable plaintext (article title +
        abstract + body), one paragraph per line. Whitespace inside a
        paragraph is normalised so a paper-extractor's verbatim quotes stay
        self-consistent with this stored text. Robust to JATS DOCTYPE +
        publisher-specific named entities that ElementTree cannot resolve.
        """
        import xml.etree.ElementTree as ET
        # Drop DOCTYPE (internal subset) + namespace decls/prefixes, and
        # neutralise non-builtin named entities so parsing never aborts.
        xml_text = re.sub(r"<!DOCTYPE[^>]*?>", "", xml_text, flags=re.S)
        xml_text = re.sub(r'\sxmlns(:\w+)?="[^"]*"', " ", xml_text)
        # Strip namespace prefixes from BOTH tags (<mml:math>) and
        # attributes (xlink:href=) -- otherwise removing the xmlns
        # declaration leaves an unbound prefix that aborts the parse.
        xml_text = re.sub(r"(<\/?)[A-Za-z][\w.-]*:", r"\1", xml_text)
        xml_text = re.sub(r"(\s)[A-Za-z][\w.-]*:([A-Za-z][\w.-]*\s*=)", r"\1\2", xml_text)
        xml_text = re.sub(
            r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[\w.-]+;",
            " ", xml_text,
        )
        try:
            root = ET.fromstring(xml_text)
        except Exception:  # noqa: BLE001
            return ""
        out: list[str] = []

        def _para(el: Any) -> None:
            t = " ".join("".join(el.itertext()).split())
            if t:
                out.append(t)

        at = root.find(".//article-title")
        if at is not None:
            _para(at)
        for ab in root.findall(".//abstract"):
            for p in ab.iter():
                if p.tag.split("}")[-1] in ("p", "title"):
                    _para(p)
        body = root.find(".//body")
        if body is not None:
            def walk(el: Any) -> None:
                for child in el:
                    ln = child.tag.split("}")[-1]
                    if ln in ("p", "title", "label", "caption"):
                        _para(child)
                    elif ln in ("sec", "body", "fig", "table-wrap",
                                "boxed-text", "list", "list-item",
                                "disp-quote", "supplementary-material"):
                        walk(child)
            walk(body)
        text = "\n\n".join(out)
        return re.sub(r"\n{3,}", "\n\n", text).strip()

    # ------------------------------------------------------------------ #
    # Sci-Hub MCP cascade -- internal
    # ------------------------------------------------------------------ #

    async def _scihub_acquire(self, doi: str, dest: Path) -> bool:
        """Spawn the Sci-Hub MCP server (one-shot) and acquire one DOI.

        Uses the patched server at ``self.scihub_mcp_path``. Returns
        True on success. The spawning is intentionally one-shot per
        call: the gentle pacing matters more than process reuse here,
        and the per-call overhead is negligible against the
        ``pace_seconds`` delay the caller imposes.
        """
        if self.scihub_mcp_path is None:
            return False
        try:
            # Lazy import to keep corpus_lib optional in tests
            import sys
            scripts_root = Path(__file__).resolve().parents[5] / "scripts"
            if str(scripts_root) not in sys.path:
                sys.path.insert(0, str(scripts_root))
            from corpus_lib.mcp_client import MCPClient  # type: ignore[import-not-found]
        except Exception as exc:  # noqa: BLE001
            self.log.debug("scihub MCP client import failed: %s", exc)
            return False

        try:
            async with MCPClient(
                command="python", args=[str(self.scihub_mcp_path)],
            ) as mcp:
                search_res = await mcp.call_tool(
                    "search_scihub_by_doi", {"doi": doi},
                )
                payload = self._unwrap_mcp(search_res)
                pdf_url = (
                    payload.get("pdf_url")
                    if isinstance(payload, dict) else None
                )
                if not pdf_url:
                    return False
                dl_res = await mcp.call_tool(
                    "download_scihub_pdf",
                    {"pdf_url": pdf_url, "output_path": str(dest)},
                )
                _ = dl_res
                if not dest.exists() or dest.stat().st_size < 1024:
                    if dest.exists():
                        dest.unlink()
                    return False
                if dest.read_bytes()[:5] != b"%PDF-":
                    dest.unlink()
                    return False
                return True
        except Exception as exc:  # noqa: BLE001
            self.log.debug("scihub acquire failed: %s", exc)
            return False

    @staticmethod
    def _unwrap_mcp(res: Any) -> Any:
        """MCP results wrap content in ``{"content": [{type, text}]}``."""
        if isinstance(res, dict) and isinstance(res.get("content"), list):
            chunks = res["content"]
            if chunks and isinstance(chunks[0], dict) and chunks[0].get("type") == "text":
                text = chunks[0].get("text", "")
                stripped = text.strip()
                if (stripped.startswith("{") and stripped.endswith("}")) or \
                   (stripped.startswith("[") and stripped.endswith("]")):
                    try:
                        return json.loads(stripped)
                    except json.JSONDecodeError:
                        return text
                return text
        return res

    # ------------------------------------------------------------------ #
    # Post-acquisition: text + KG + provenance + manifest
    # ------------------------------------------------------------------ #

    def _extract_text(self, pdf: Path, txt: Path) -> int:
        """Extract plaintext via pdfminer. Returns char count, or -1 on failure."""
        if txt.exists() and txt.stat().st_size > 0:
            return txt.stat().st_size
        try:
            from pdfminer.high_level import extract_text as _pdf_extract  # type: ignore[import-untyped]
        except ImportError:
            self.log.debug("pdfminer.six not installed; skipping extraction")
            return -1
        try:
            text = _pdf_extract(str(pdf))
        except Exception as exc:  # noqa: BLE001
            self.log.debug("pdfminer failed for %s: %s", pdf.name, exc)
            return -1
        txt.write_text(text or "", encoding="utf-8")
        return len(text or "")

    def _record_acquisition_artifacts(
        self,
        *,
        result: AcquisitionResult,
        year: int,
        venue: Optional[str],
        lang: str,
    ) -> None:
        """Write KG fragment + provenance ledger entry (best-effort)."""
        if self.kg_store is not None:
            try:
                self._write_kg_skeleton(
                    result=result, year=year, venue=venue, lang=lang,
                )
            except Exception as exc:  # noqa: BLE001
                self.log.debug("kg_store write failed: %s", exc)

        if self.provenance_ledger is not None:
            try:
                evidence = [result.pdf_url_used] if result.pdf_url_used else []
                self.provenance_ledger.record(
                    sentence_id=f"acquisition__{_safe_filename_stem(result.doi)}",
                    sentence=(
                        f"Acquired full text of DOI {result.doi} via "
                        f"{result.source} (license: {result.license or 'unknown'})."
                    ),
                    agent="corpus_acquisition",
                    model="acquisition_pipeline",
                    evidence=evidence,
                    reflection_rounds=0,
                )
            except Exception as exc:  # noqa: BLE001
                self.log.debug("provenance_ledger record failed: %s", exc)

    def _write_kg_skeleton(
        self,
        *,
        result: AcquisitionResult,
        year: int,
        venue: Optional[str],
        lang: str,
    ) -> None:
        """Emit a paper-skeleton KGFragment.

        Claims / methods / results / limitations / entities are left
        empty -- downstream paper-extractor + claim-verifier agents
        populate them when the manuscript phase runs against this paper.
        """
        try:
            from .sgca.schema import (  # type: ignore[import-not-found]
                Author, KGFragment, KGNodes, Paper, Provenance, RawPointer,
            )
        except Exception:  # noqa: BLE001
            return
        _ = Paper, Provenance  # imported for symmetry; not yet used here

        paper_id = _safe_filename_stem(result.doi)
        raw = RawPointer(
            pdf=str(result.pdf_path) if result.pdf_path else None,
            text=str(result.text_path) if result.text_path else "",
            byte_len=result.bytes_written,
        )
        frag = KGFragment(
            paper_id=paper_id,
            doi=result.doi,
            title=result.title,
            year=year,
            authors=[],  # filled later by paper-extractor
            venue=venue,
            language=lang,
            license=result.license or "unknown",
            raw_pointer=raw,
            nodes=KGNodes(),
            edges=[],
        )
        self.kg_store.write_paper(frag)

    def _append_manifest(
        self,
        result: AcquisitionResult,
        out_dir: Path,
        *,
        year: int,
        venue: Optional[str],
    ) -> None:
        """Append the result to ``<out_dir>/downloaded.jsonl``."""
        if not result.success:
            return
        entry = {
            "doi": result.doi,
            "title": result.title,
            "year": year,
            "venue": venue,
            "source": result.source,
            "pdf_url": result.pdf_url_used,
            "host": result.pdf_host,
            "license": result.license,
            "pdf_path": str(result.pdf_path) if result.pdf_path else None,
            "text_path": str(result.text_path) if result.text_path else None,
            "ts": time.time(),
        }
        manifest = out_dir / "downloaded.jsonl"
        with manifest.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _out_dir(self, discipline: str, lang: str) -> Path:
        return self.corpus_root / discipline / lang


# ---------------------------------------------------------------------------
# Convenience: build a default pipeline from environment
# ---------------------------------------------------------------------------


def build_default_pipeline(
    *,
    job_id: Optional[str] = None,
    pace_seconds: float = 25.0,
    enable_annas_fallback: bool = False,
    enable_scihub_fallback: bool = False,
    enable_kg_store: bool = False,
    corpus_root: Optional[Path] = None,
) -> CorpusAcquisitionPipeline:
    """Construct a ready-to-use pipeline from ``OPENALEX_EMAIL`` and
    ``VEDIX_HOME`` env vars, with optional KG store + Anna's + Sci-Hub
    fallbacks.

    The literature-searcher agent and the corpus_lib scripts both call
    this when they don't need fine-grained construction.
    """
    crossref_email = os.environ.get("OPENALEX_EMAIL", "").strip()
    if not crossref_email:
        raise RuntimeError("OPENALEX_EMAIL not set in environment")

    vedix_home = Path(os.environ.get(
        "VEDIX_HOME",
        os.environ.get("AI_SCIENTIST_HOME", str(Path.home() / ".vedix")),
    ))

    scihub_path: Optional[Path] = None
    if enable_scihub_fallback:
        candidate = vedix_home / "external" / "Sci-Hub-MCP-Server" / "sci_hub_server.py"
        if candidate.exists():
            scihub_path = candidate

    annas_key: Optional[str] = None
    annas_base = os.environ.get("ANNAS_BASE_URL", "https://annas-archive.org")
    if enable_annas_fallback:
        annas_key = os.environ.get("ANNAS_SECRET_KEY", "").strip() or None

    kg_store = None
    if enable_kg_store and job_id:
        try:
            from .sgca.kg_store import KGStore, Tier  # type: ignore[import-not-found]
            kg_store = KGStore(Tier.JOB, scope_id=job_id)
        except Exception:  # noqa: BLE001
            kg_store = None

    ledger = SourceLedger(
        configured=["oa_direct", "europepmc", "annas", "scihub_mcp", "crossref_gate"],
    )
    return CorpusAcquisitionPipeline(
        crossref_email=crossref_email,
        source_ledger=ledger,
        corpus_root=corpus_root or (vedix_home / "corpus"),
        pace_seconds=pace_seconds,
        scihub_mcp_path=scihub_path,
        annas_secret_key=annas_key,
        annas_base_url=annas_base,
        kg_store=kg_store,
    )


__all__ = [
    "AcquisitionResult",
    "CorpusAcquisitionPipeline",
    "build_default_pipeline",
    "LEGITIMATE_OA_HOSTS",
]
