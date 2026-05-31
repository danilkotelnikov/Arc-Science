from __future__ import annotations
import asyncio
import time
import yaml
from dataclasses import dataclass, field
from pathlib import Path
from pydantic import ValidationError
from ..dispatch import dispatch_agent
from .schema import KGFragment
from .kg_store import KGStore


class ExtractionFailure(Exception):
    ...


@dataclass
class _Failure:
    paper_id: str
    reason: str
    attempt: int


class GraphBuilder:
    def __init__(self, *, store: KGStore, concurrency: int = 8, max_retries: int = 1):
        self.store = store
        self.concurrency = concurrency
        self.max_retries = max_retries

    async def run(self, *, paper_list: list[dict]) -> dict:
        sem = asyncio.Semaphore(self.concurrency)
        failures: list[_Failure] = []
        extracted: list[str] = []

        async def _one(paper: dict):
            async with sem:
                try:
                    await self._extract_with_retries(paper)
                    extracted.append(paper["id"])
                except ExtractionFailure as e:
                    failures.append(_Failure(paper_id=paper["id"], reason=str(e),
                                             attempt=self.max_retries + 1))

        await asyncio.gather(*[_one(p) for p in paper_list])
        return {
            "extracted": len(extracted),
            "failed": len(failures),
            "failures": [{"paper_id": f.paper_id, "reason": f.reason} for f in failures],
        }

    # ----- workflow-compatible seam ---------------------------------------
    # graph_builder.run() calls dispatch_agent (host-native only). When the
    # extraction is performed by a Workflow agent() instead, the caller
    # already holds the YAML; ingest_fragment validates + byte-verifies +
    # writes it to the store WITHOUT re-dispatching. This is how a Workflow
    # builds a real grounded KG before the writer is unblocked.

    def ingest_fragment(self, yaml_text: str, paper: dict) -> KGFragment:
        """Parse, schema-validate, byte-verify quotes, and persist one
        externally-produced KGFragment. Raises ExtractionFailure /
        ValidationError on any failure (so the caller can substitute the
        paper rather than persist an ungrounded fragment).
        """
        frag = self._parse_and_validate(yaml_text, paper)
        self._verify_quotes_against_raw(
            frag, raw_text_path=Path(paper["raw_text_path"]),
        )
        self.store.write_paper(frag)
        return frag

    async def _extract_with_retries(self, paper: dict) -> None:
        last_err = None
        for attempt in range(self.max_retries + 1):
            try:
                yaml_text = await self._call_extractor(paper, attempt=attempt)
                frag = self._parse_and_validate(yaml_text, paper)
                self._verify_quotes_against_raw(frag, raw_text_path=Path(paper["raw_text_path"]))
                self.store.write_paper(frag)
                return
            except (ValidationError, ExtractionFailure, yaml.YAMLError) as e:
                last_err = e
                continue
        raise ExtractionFailure(f"after {self.max_retries + 1} attempts: {last_err}")

    async def _call_extractor(self, paper: dict, *, attempt: int) -> str:
        raw_text = Path(paper["raw_text_path"]).read_text(encoding="utf-8")
        stricter_suffix = (
            "\n\nSCHEMA REMINDER: Output ONLY the YAML document. "
            "Every verbatim_quote MUST be a contiguous substring of the raw text. "
            "Every quote_byte_range MUST point to exact byte offsets."
        ) if attempt > 0 else ""
        prompt = (
            f"Extract a KG fragment from this paper.\n\n"
            f"Paper metadata:\n{paper.get('doi', '')} — {paper.get('title', '')}\n\n"
            f"Raw text:\n```\n{raw_text}\n```{stricter_suffix}"
        )
        resp = await dispatch_agent(agent_type="paper-extractor", prompt=prompt, max_tokens=8192)
        return resp.content

    def _parse_and_validate(self, yaml_text: str, paper: dict) -> KGFragment:
        try:
            data = yaml.safe_load(yaml_text)
        except yaml.YAMLError as e:
            raise ExtractionFailure(f"YAML parse error: {e}") from e
        if not isinstance(data, dict):
            raise ExtractionFailure(f"YAML did not parse to a mapping: {type(data).__name__}")
        # Inject extractor_ts if missing
        for claim in (data.get("nodes", {}).get("claims") or []):
            claim.setdefault("provenance", {}).setdefault("extractor_ts", time.time())
        return KGFragment.model_validate(data)

    def _verify_quotes_against_raw(self, frag: KGFragment, *, raw_text_path: Path) -> None:
        raw = raw_text_path.read_text(encoding="utf-8")
        for claim in frag.nodes.claims:
            s, e = claim.quote_byte_range
            actual = raw[s:e]
            if actual != claim.verbatim_quote:
                # Fallback: try substring search; if found, suggest correct range in the error
                idx = raw.find(claim.verbatim_quote)
                if idx == -1:
                    raise ExtractionFailure(
                        f"verbatim quote not found in raw for claim {claim.id}: "
                        f"expected {claim.verbatim_quote[:80]!r}"
                    )
                raise ExtractionFailure(
                    f"verbatim quote byte_range mismatch for {claim.id}: "
                    f"reported [{s},{e}] but actual offset is [{idx},{idx + len(claim.verbatim_quote)}]"
                )

    # ----- Cross-paper edge inference (second pass) -----

    async def infer_cross_paper_edges(self, *, top_k: int = 20, candidate_threshold: float = 0.55,
                                      edge_confidence_threshold: float = 0.7) -> int:
        """SGCA §4.4: top-k candidate selection by claim-paraphrase embedding cosine,
        then LLM classification per pair. Writes contradicts/extends/supports edges
        for confidence > edge_confidence_threshold."""
        from .schema import Edge
        paper_ids = self.store.list_paper_ids()
        all_claims: list[tuple[str, str]] = []  # (claim_id, paraphrase)
        for pid in paper_ids:
            paper = self.store.read_paper(pid)
            if paper is None:
                continue
            for c in paper.nodes.claims:
                all_claims.append((c.id, c.paraphrase))

        n_written = 0
        for i, (cid_a, p_a) in enumerate(all_claims):
            scored: list[tuple[str, float]] = []
            for j, (cid_b, p_b) in enumerate(all_claims):
                if i == j:
                    continue
                if cid_a.split(".")[0] == cid_b.split(".")[0]:
                    continue  # skip same-paper pairs
                cos = await self._pair_label_cosine(p_a, p_b)
                if cos >= candidate_threshold:
                    scored.append((cid_b, cos))
            scored.sort(key=lambda x: x[1], reverse=True)
            for cid_b, _ in scored[:top_k]:
                verdict = await self._classify_pair(cid_a, cid_b)
                if verdict["edge_kind"] in ("contradicts", "extends", "supports") and \
                   verdict["confidence"] >= edge_confidence_threshold:
                    self.store.write_edge(Edge(**{
                        "from": cid_a, "to": cid_b,
                        "kind": verdict["edge_kind"],
                        "confidence": verdict["confidence"],
                    }))
                    n_written += 1
        return n_written

    async def _pair_label_cosine(self, a: str, b: str) -> float:
        from .embeddings import label_cosine
        return await label_cosine(a, b)

    async def _classify_pair(self, claim_a_id: str, claim_b_id: str) -> dict:
        paper_a = self.store.read_paper(claim_a_id.split(".")[0])
        paper_b = self.store.read_paper(claim_b_id.split(".")[0])
        ca = next(c for c in paper_a.nodes.claims if c.id == claim_a_id)
        cb = next(c for c in paper_b.nodes.claims if c.id == claim_b_id)
        prompt = (
            f"Decide the relationship between these two claims from different papers.\n\n"
            f"Claim A ({claim_a_id}): {ca.paraphrase}\n  Quote: \"{ca.verbatim_quote}\"\n\n"
            f"Claim B ({claim_b_id}): {cb.paraphrase}\n  Quote: \"{cb.verbatim_quote}\"\n\n"
            f"Reply ONLY with JSON: "
            f'{{"edge_kind": "contradicts" | "extends" | "supports" | "none", "confidence": <0.0-1.0>}}'
        )
        resp = await dispatch_agent(agent_type="paper-extractor", prompt=prompt, max_tokens=128)
        import json as _j
        try:
            return _j.loads(resp.content)
        except Exception:
            return {"edge_kind": "none", "confidence": 0.0}
