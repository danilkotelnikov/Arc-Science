# Novelty check and sources

Companion to `thesis.md`. Hypothesis under test: *signed cross-modal disagreement between a protein language model and a DNA language model, used as a training-free classifier of variant mechanism (splicing-mediated vs protein-coding).*

## Novelty verdict

**Candidate incremental framing; novelty unestablished.** The bounded [2026-09-18 audit](novelty-audit-2026-09-18.md) did not identify an exact published predecessor for this gate. This is a retrieval outcome, not proof of originality; no mechanism-classification experiment has been performed. Relevant prior art:

- Nucleotide LMs: SpliceBERT predicts splicing effects [4]; GPN-MSA predicts broader genome-wide deleteriousness [5].
- Supervised splice oracles: SpliceAI [2], Pangolin [3] — Pangolin *observed* the 5–10% missense-via-splicing phenomenon this thesis targets, but attributes it with a splice model alone.
- Multimodal **fusion**: MOSAIC [6] combines nucleotide representations and annotations and also reports interpretability analyses. Fusion does not inherently discard mechanistic information.
- Older mechanism-oriented prediction and integration: MutPred Splice [13] and CADD-Splice [14]. The broad premise of separating molecular effects is established.

Absence claim (#12 in the fact-check table) is "unverified-absence": the searches below returned no matching method, but the search was not exhaustive (Semantic Scholar was rate-limited; several servers were unauthenticated/timed out — see below).

## Sources (real, with identifiers)

The original authoring-session checks are retained below. Entries 4–6, 8–10, 13–14 were rechecked against primary records on 2026-09-18. Metadata verification establishes bibliographic identity, not empirical validity.

1. Cheng J. et al. (2023). Accurate proteome-wide missense variant effect prediction with AlphaMissense. *Science* 381:eadg7492. **PMID 37733863**, DOI 10.1126/science.adg7492. — Verified (web_search, PubMed).
2. Jaganathan K. et al. (2019). Predicting Splicing from Primary Sequence with Deep Learning (SpliceAI). *Cell* 176:535–548. **PMID 30661751**. — Verified (web_search).
3. Zeng T., Li Y.I. (2022). Predicting RNA splicing from DNA sequence using Pangolin. *Genome Biology* 23:103. **DOI 10.1186/s13059-022-02664-4**, PMC9022248. — Verified (web_search).
4. Chen K. et al. (2024). Self-supervised learning on millions of primary RNA sequences from 72 vertebrates improves sequence-based RNA splicing prediction (SpliceBERT). *Briefings in Bioinformatics* 25(3):bbae163. [DOI 10.1093/bib/bbae163](https://doi.org/10.1093/bib/bbae163), [PMID 38605640](https://pubmed.ncbi.nlm.nih.gov/38605640/). Primary RNA model; not exclusively a DNA-trained model.
5. Benegas G. et al. (2025). A DNA language model based on multispecies alignment predicts the effects of genome-wide variants (GPN-MSA). *Nature Biotechnology* 43:1960–1965. [DOI 10.1038/s41587-024-02511-w](https://www.nature.com/articles/s41587-024-02511-w). Published 2 January 2025; requires multispecies alignment inputs.
6. Li X. et al. (2026). Pathogenicity prediction for noncanonical splice-altering variants based on multimodal feature fusion (MOSAIC). *Briefings in Bioinformatics* 27(3):bbag291. [DOI 10.1093/bib/bbag291](https://doi.org/10.1093/bib/bbag291), [PMID 42242678](https://pubmed.ncbi.nlm.nih.gov/42242678/). Relevant fusion and interpretability prior art; not proven to be the unique closest predecessor.
7. Lin Z. et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model (ESM-2). *Science* 379:1123–1130. DOI 10.1126/science.ade2574. — Journal/pages verified (Nature Methods reference excerpt); DOI high-confidence, partial.
8. Meier J. et al. (2021). Language models enable zero-shot prediction of the effects of mutations on protein function (ESM-1v). NeurIPS 34:29287–29303. [Proceedings paper](https://proceedings.neurips.cc/paper_files/paper/2021/file/f51338d736f95dd42427296047067694-Paper.pdf). Method basis for masked-marginal scoring.
9. Cheung R. et al. (2019). A Multiplexed Assay for Exon Recognition Reveals that an Unappreciated Fraction of Rare Genetic Variants Cause Large-Effect Splicing Disruptions (MFASS). *Molecular Cell*. [PMID 30503770](https://pubmed.ncbi.nlm.nih.gov/30503770/), [primary full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC6599603/). Published SDV definition: Δinclusion index ≤ −0.5; this is not a generic absolute Δψ threshold.
10. Adamson S.I. et al. (2018). Vex-seq: high-throughput identification of the impact of genetic variation on pre-mRNA splicing efficiency. *Genome Biology*. [PMID 29859120](https://pubmed.ncbi.nlm.nih.gov/29859120/), [DOI 10.1186/s13059-018-1437-x](https://doi.org/10.1186/s13059-018-1437-x). Splicing assay, not paired proof of protein-function mechanism.
11. Nguyen E. et al. (2023). HyenaDNA: Long-Range Genomic Sequence Modeling at Single Nucleotide Resolution. **arXiv:2306.15794**. — Verified (arXiv). Candidate gLM.
12. Otari — Variant-resolved prediction of context-specific isoform variation with a graph-based attention model (2025). *Cell Genomics* S2666-979X(25)00382-9. — Related work (isoform-level VEP), verified via web_search excerpt; exact DOI unverified.

Optional/context (mentioned via excerpts, not independently verified): ProteinGym (Notin et al., 2023, NeurIPS) as a VEP benchmark; AlphaGenome (Avsec et al., 2025) as a supervised regulatory oracle; Nucleotide Transformer (Dalla-Torre et al., 2025, *Nature Methods*) as an alternative gLM — all identifier-unverified this session.

13. Mort M. et al. (2014). MutPred Splice: machine learning-based prediction of exonic variants that disrupt splicing. *Genome Biology* 15:R19. [DOI 10.1186/gb-2014-15-1-r19](https://doi.org/10.1186/gb-2014-15-1-r19), [PMID 24451234](https://pubmed.ncbi.nlm.nih.gov/24451234/). Established prediction of splicing disruption by coding substitutions.
14. Rentzsch P. et al. (2021). CADD-Splice—improving genome-wide variant effect prediction using deep learning-derived splice scores. *Genome Medicine* 13:31. [DOI 10.1186/s13073-021-00835-9](https://link.springer.com/article/10.1186/s13073-021-00835-9). Integrates process-specific splice scores into variant prediction.

## Connectors: original authoring session

This historical log is not the current availability report. The 2026-09-18 audit successfully used alphaXiv and Undermind and rechecked primary records. Original wording that a search "resolved novelty" should be read only as a provisional authoring assessment.

**Worked:**
- `mcp__pubmed__search_articles` — returned PMIDs; confirmed AlphaMissense, SpliceAI, MFASS (30503770), Vex-seq (29859120).
- `mcp__arxiv__search_papers` — confirmed HyenaDNA (2306.15794); mostly off-target on the splicing query (retrieval noise).
- `mcp__plugin_bio-research_consensus__search` — highest-value hits: SpliceBERT, GPN-MSA, MOSAIC (capped at 3 results without account).
- `mcp__6b3ab657...__web_search` — confirmed identifiers for AlphaMissense, SpliceAI, Pangolin, ESM-2, plus Otari/AlphaGenome context.

**Failed / unavailable:**
- `mcp__semanticscholar__search_semantic_scholar` — **HTTP 429 rate-limited** (API key needed); no results.
- `openalex`, `fetcher` MCP servers — **CONNECT_TIMEOUT** (failed to connect this session).
- `biorxiv` and most plugin research connectors — **require authentication** (non-interactive session; not usable here).
- alphaXiv (`discover_papers`) and firecrawl research — schemas loaded but not called in the original session. Retrieved citations did not establish novelty.

## Limitations of the original check

The following records the original session. The current audit resolves SpliceBERT, GPN-MSA, and MOSAIC identifiers and corrects proposal overclaims; Otari remains unverified here. No real model/assay benchmark has been run.

- Semantic Scholar (largest CS/bio index for the "disagreement" concept) was unavailable, so the absence claim rests on PubMed + Consensus + web_search.
- The original session left SpliceBERT, GPN-MSA, MOSAIC, and Otari DOIs unconfirmed. The current audit resolves the first three; Otari remains outside this bounded check.
- The thesis is a proposal. Its novelty wording and several methodological overclaims required correction; no PLM/gLM benchmark was performed.
