# Scientific novelty audit: PLM–gLM disagreement

Date: 2026-09-18. Scope: the existing thesis, sources, and Arc Science usability evaluation. Method: bounded literature retrieval, primary-record checks, and mathematical/design review using the scientific-critical-thinking skill. No model inference, assay analysis, or new biological experiment was run.

**Verdict: a plausible methodological proposal with unestablished novelty and no demonstrated mechanism-classification result.** The search did not retrieve an exact predecessor for the proposed fixed gate. That is not proof of absence, originality, usefulness, or clinical validity. The usability evaluation's phrase “genuinely novel” exceeds the evidence.

## Prior art and verified identifiers

| Primary work | Verified relevance and implication |
| --- | --- |
| [MutPred Splice: machine learning-based prediction of exonic variants that disrupt splicing](https://pubmed.ncbi.nlm.nih.gov/24451234/) (2014), DOI 10.1186/gb-2014-15-1-r19 | Already targets splice disruption by coding substitutions. The biological question and mechanism-oriented classification are established. |
| [CADD-Splice](https://link.springer.com/article/10.1186/s13073-021-00835-9) (2021), DOI 10.1186/s13073-021-00835-9 | Integrates process-specific splicing predictions into general variant scoring and uses MFASS for evaluation. Integration is established prior art. |
| [Pangolin](https://pmc.ncbi.nlm.nih.gov/articles/9022248/) (2022), DOI 10.1186/s13059-022-02664-4 | Discusses an estimated 5–10% of loss-of-function missense variants potentially acting through splicing in its analysis. This is not evidence that all splice-mediated missense changes are chemically conservative or have low PLM scores. |
| [SpliceBERT](https://pubmed.ncbi.nlm.nih.gov/38605640/) (2024), DOI 10.1093/bib/bbae163 | Reports zero-shot splicing-effect prediction using a model pretrained on primary RNA sequences. The thesis's final-layer cosine statistic still requires validation; performance of another scoring rule does not validate it. |
| [GPN-MSA](https://www.nature.com/articles/s41587-024-02511-w) (2025), DOI 10.1038/s41587-024-02511-w | Predicts genome-wide deleteriousness using multispecies alignments. It is neither exclusively a splice predictor nor interchangeable with a single-sequence model. |
| [MOSAIC](https://doi.org/10.1093/bib/bbag291) (2026), PMID 42242678 | Combines genomic representations, local features, and annotations; also reports motif/feature interpretation. The assertion that fusion necessarily discards mechanism is incorrect. Its task is pathogenicity prediction, not the exact fixed PLM–gLM contrast. |

The masked-marginal foundation is verified in [Meier et al., NeurIPS 2021](https://proceedings.neurips.cc/paper_files/paper/2021/file/f51338d736f95dd42427296047067694-Paper.pdf). MFASS is [PMID 30503770](https://pubmed.ncbi.nlm.nih.gov/30503770/); Vex-seq is [PMID 29859120](https://pubmed.ncbi.nlm.nih.gov/29859120/), DOI 10.1186/s13059-018-1437-x. The companion bibliography now has corrected titles and previously missing core identifiers.

These are relevant neighbors, not a proven exhaustive ranking of closest prior art. A defensible candidate contribution is the specific fixed contrast and its empirical behavior. “Mechanistic interpretation” and “combining predictors” are too broad to claim as new.

## Findings that change the experiment

1. **Synonymous ranking cannot improve through this gate alone.** Algebraically, fixed background scaling makes $z_P=c$ for every synonymous variant. Then $D=C\sigma(\alpha(z_G-\tau_G))$, with constant $C>0$, so its ranking equals the genomic score's ranking. Ideal rank-based AUPRC and precision@k must therefore match within this stratum, apart from ties or numerical saturation. An exclusively synonymous normalization background makes $\sigma_P=0$ and is invalid. These are deductions from the proposed equations, not empirical findings.

2. **Score disagreement is not a mechanism label.** The nonnegative gate is not itself signed; only $\Delta=z_G-z_P$ is signed. Low predicted protein damage does not establish absence of protein damage. High genomic perturbation has no proven specificity for splicing. Splice-only, protein-only, dual-effect, and neither-effect categories require independent labels; an assay measuring only splicing cannot establish all four. Thus MFASS/Vex-seq can first test prioritization, not complete mechanism attribution.

3. **The assay endpoint was misstated.** The [MFASS primary paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC6599603/) defines splice-disrupting variants using a decrease in inclusion index of at least 0.5. Replacing this with absolute Δψ changes both measurement and positive-class definition. Preserve each assay's native labels, quality filters, units, reference context, and release.

4. **The proposed significance test is insufficient.** Partial correlation measures linear residual association, not all information beyond an oracle. Permuting raw outcomes destroys their relationship with the oracle and generally tests the wrong null. Nuisance-aware permutation requires a justified design and exchangeability assumptions; see [Winkler et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4010955/), DOI 10.1016/j.neuroimage.2014.01.060. Variants sharing genes/exons cannot simply be treated as independent replicates. Failure to reach significance is not proof of redundancy.

5. **“Training-free” needs a frozen specification.** Fix model/checkpoint, layer, strand handling, transcript mapping, context, token alignment, background population, thresholds, and sharpness before test labels are inspected. GPN-MSA needs aligned species inputs; the generic $L\times d$ definition cannot silently assume all candidates accept the same input. A learned incremental evaluation model can be used, but must be disclosed separately from the fixed scoring rule.

## Empirical acceptance gates

- **Reproducibility:** version and hash data/models; document genome build and isoforms; reject zero-variance scaling, invalid sequence mappings, and nonfinite scores. State exclusions and missing-score coverage for every comparator.
- **Leakage control:** lock a gene-group split and final external assay before tuning. Audit overlapping variants/genes and known predictor training or benchmark reuse; gene splitting alone does not establish freedom from pretraining contamination.
- **Primary comparison:** test the fixed gate against genomic-only, protein-only, signed difference, and simple combined-score baselines on identical variants. Compare oracle-only with oracle-plus-gate using training-only fitting and frozen held-out predictions.
- **Stratification:** report missense and synonymous results separately and by splice distance. Treat synonymous rank equivalence as a mathematical control. Do not let variant-class composition masquerade as cross-modal gain.
- **Evidence threshold:** preregister a practically meaningful improvement and a power/precision target. Require a paired gene-cluster 95% interval above the chosen improvement threshold on the primary endpoint, with external replication and multiplicity control. Report an imprecise null as inconclusive; report a precise exclusion of the useful effect as evidence against that effect.
- **Mechanism extension:** require independent RNA and protein-function measurements before claiming mechanism classification. Report performance for dual-effect variants and uncertainty/abstention, not forced binary explanations.

## Connector and verification log

| Surface | Operation and outcome |
| --- | --- |
| alphaXiv | One difficulty-5 discovery query using SpliceBERT, GPN-MSA, MOSAIC, disagreement, protein language model. Returned nine mainly adjacent/off-target candidates; no exact gate retrieved. |
| Undermind | Orientation and workspace listing succeeded. Two semantic searches returned 8 and 6 requested-page candidates respectively, including MutPred Splice and Meier; metadata lookup confirmed their DOIs. No paid deep search or PDF subagent was launched. |
| Primary web retrieval | PubMed, publisher pages, author repository, and NeurIPS proceedings established the citations above. Direct PMC/OUP opens sometimes returned CAPTCHA/error; indexed primary text and PubMed supplied the relevant records. |
| Retrieval caution | Undermind returned inconsistent year/DOI metadata for an additional Saadat candidate; it was not relied on. Off-topic hits were excluded, not counted as negative novelty evidence. |

Queries emphasized protein/DNA score disagreement, splice-versus-protein effects, and the named methods. Coverage was not systematic: no exhaustive citation-chain review, full supplementary-method comparison, or guarantee of coverage for preprints and nonindexed work. Optional Otari/AlphaGenome references were not revalidated in this bounded audit.

The original thesis and sources received narrow corrections for factual overclaims and experimental interpretation. No scientific-performance claim is upgraded by the documentation changes. Real model scores, paired mechanism labels, confirmatory statistics, assay replication, and clinical validity remain untested.
