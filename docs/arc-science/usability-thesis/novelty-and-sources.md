# Novelty check and sources

Companion to `thesis.md`. Hypothesis under test: *signed cross-modal disagreement between a protein language model and a DNA language model, used as a training-free classifier of variant mechanism (splicing-mediated vs protein-coding).*

## Novelty verdict

**Novel framing, incremental components.** The disagreement statistic $D_{\text{splice}}$ / $\Delta$ as a *mechanism classifier* was not found in the literature searched. Adjacent-but-distinct prior art:

- Genomic LMs that predict splicing **effect** (not mechanism contrast): SpliceBERT [4], GPN-MSA [5].
- Supervised splice oracles: SpliceAI [2], Pangolin [3] — Pangolin *observed* the 5–10% missense-via-splicing phenomenon this thesis targets, but attributes it with a splice model alone.
- Multimodal **fusion** (combines modalities, discards disagreement): MOSAIC [6], AlphaMissense's hybrid design [1]. This is the closest prior art; the distinction (fusion vs signed disagreement) is the crux of the novelty.

Absence claim (#12 in the fact-check table) is "unverified-absence": the searches below returned no matching method, but the search was not exhaustive (Semantic Scholar was rate-limited; several servers were unauthenticated/timed out — see below).

## Sources (real, with identifiers)

Verified this session unless marked. Verified = the identifier or exact title/journal/year was returned by a connector during this run.

1. Cheng J. et al. (2023). Accurate proteome-wide missense variant effect prediction with AlphaMissense. *Science* 381:eadg7492. **PMID 37733863**, DOI 10.1126/science.adg7492. — Verified (web_search, PubMed).
2. Jaganathan K. et al. (2019). Predicting Splicing from Primary Sequence with Deep Learning (SpliceAI). *Cell* 176:535–548. **PMID 30661751**. — Verified (web_search).
3. Zeng T., Li Y.I. (2022). Predicting RNA splicing from DNA sequence using Pangolin. *Genome Biology* 23:103. **DOI 10.1186/s13059-022-02664-4**, PMC9022248. — Verified (web_search).
4. Chen K. et al. (2024). Self-supervised learning on primary RNA sequences from 72 vertebrates improves sequence-based RNA splicing prediction (SpliceBERT). *Briefings in Bioinformatics*. — Title/journal/year verified (Consensus); DOI unverified this session.
5. Benegas G. et al. (2025). A DNA language model based on multispecies alignment predicts the effects of genome-wide variants (GPN-MSA). *Nature Biotechnology*. — Title/journal/year verified (Consensus); DOI unverified this session.
6. Li X. et al. (2026). Pathogenicity prediction for noncanonical splice-altering variants based on multimodal feature fusion (MOSAIC). *Briefings in Bioinformatics*. — Title/journal/year verified (Consensus); DOI unverified. Closest prior art (fusion, not disagreement).
7. Lin Z. et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model (ESM-2). *Science* 379:1123–1130. DOI 10.1126/science.ade2574. — Journal/pages verified (Nature Methods reference excerpt); DOI high-confidence, partial.
8. Meier J. et al. (2021). Language models enable zero-shot prediction of the effects of mutations on protein function (ESM-1v). NeurIPS. — Method basis for Eq. 1 (masked-marginal). Identifier unverified this session.
9. Cheung R. et al. (2019). A multiplexed assay for exon recognition reveals large-effect splicing disruptions from rare variants (MFASS). *Molecular Cell*. **PMID 30503770**. — Verified (PubMed). Ground-truth dataset.
10. Adamson S.I. et al. (2018). Vex-seq: high-throughput identification of the impact of genetic variants on pre-mRNA splicing. *Genome Biology*. **PMID 29859120**. — Verified (PubMed). Ground-truth dataset.
11. Nguyen E. et al. (2023). HyenaDNA: Long-Range Genomic Sequence Modeling at Single Nucleotide Resolution. **arXiv:2306.15794**. — Verified (arXiv). Candidate gLM.
12. Otari — Variant-resolved prediction of context-specific isoform variation with a graph-based attention model (2025). *Cell Genomics* S2666-979X(25)00382-9. — Related work (isoform-level VEP), verified via web_search excerpt; exact DOI unverified.

Optional/context (mentioned via excerpts, not independently verified): ProteinGym (Notin et al., 2023, NeurIPS) as a VEP benchmark; AlphaGenome (Avsec et al., 2025) as a supervised regulatory oracle; Nucleotide Transformer (Dalla-Torre et al., 2025, *Nature Methods*) as an alternative gLM — all identifier-unverified this session.

## Connectors: worked vs failed

**Worked:**
- `mcp__pubmed__search_articles` — returned PMIDs; confirmed AlphaMissense, SpliceAI, MFASS (30503770), Vex-seq (29859120).
- `mcp__arxiv__search_papers` — confirmed HyenaDNA (2306.15794); mostly off-target on the splicing query (retrieval noise).
- `mcp__plugin_bio-research_consensus__search` — highest-value hits: SpliceBERT, GPN-MSA, MOSAIC (capped at 3 results without account).
- `mcp__6b3ab657...__web_search` — confirmed identifiers for AlphaMissense, SpliceAI, Pangolin, ESM-2, plus Otari/AlphaGenome context.

**Failed / unavailable:**
- `mcp__semanticscholar__search_semantic_scholar` — **HTTP 429 rate-limited** (API key needed); no results.
- `openalex`, `fetcher` MCP servers — **CONNECT_TIMEOUT** (failed to connect this session).
- `biorxiv` and most plugin research connectors — **require authentication** (non-interactive session; not usable here).
- alphaXiv (`discover_papers`) and firecrawl research — schemas loaded but not called (budget; consensus + pubmed + web_search already resolved novelty).

## Honest limitations of this check

- Semantic Scholar (largest CS/bio index for the "disagreement" concept) was unavailable, so the absence claim rests on PubMed + Consensus + web_search.
- DOIs for four 2024–2026 papers (SpliceBERT, GPN-MSA, MOSAIC, Otari) were not independently confirmed this session — titles/journals/years are from connector output, not fabricated.
- No claim in `thesis.md` is presented as an experimental result; all quantitative statements are definitions, cited observations, or explicitly-flagged inferences/tests.
