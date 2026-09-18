# Cross-Modal Language-Model Disagreement as a Training-Free Classifier of Variant Mechanism

*A proposal to test whether contrasting protein and nucleotide language models helps prioritize splicing effects*

**Status (2026-09-18): unvalidated methodological hypothesis.** No PLM/gLM inference, assay benchmark, or mechanism-classification result has been produced for this proposal. The independent [novelty audit](novelty-audit-2026-09-18.md) identifies missing prior art and design limitations. Novelty is unestablished; the equations below define proposed scores, not validated mechanism labels.

## Abstract

Exonic variants can affect splicing; missense variants can also alter the encoded amino acid. These effects need not be mutually exclusive, and a synonymous variant does not change the encoded residue. Existing predictors include protein-effect models, splicing models, and integrated predictors; integration does not inherently prevent mechanistic interpretation. I propose testing whether **signed disagreement** between a self-supervised protein language model (PLM) and a self-supervised nucleotide language model (gLM), computed without task-specific parameter training, is informative for splicing prioritization. The hypothesis is that strong genomic perturbation accompanied by low PLM disruption enriches for splice-disruptive exonic variants and adds predictive information beyond a supervised splice oracle (SpliceAI/Pangolin). This document defines scores and a proposed evaluation on MFASS and Vex-seq; it reports no experimental results. **Candidate incremental framing; novelty and biological utility remain unestablished.**

## Background: the gap

Protein language models such as ESM-2 (Lin et al., 2023, *Science* 379:1123–1130) and the structure-aware AlphaMissense (Cheng et al., 2023, *Science* 381:eadg7492) provide protein-side information. A score depending only on unchanged amino-acid sequence cannot distinguish synonymous SNVs. This proposal tests whether a low PLM score helps identify splice-mediated effects; it does not assume that splice-altering missense substitutions are chemically conservative or that PLM errors identify a mechanism.

On the other axis, supervised splicing models — SpliceAI (Jaganathan et al., 2019, *Cell* 176:535–548) and Pangolin (Zeng & Li, 2022, *Genome Biology* 23:103) — predict splice-site strength directly from DNA. Notably, Pangolin's authors *observed* that 5–10% of loss-of-function missense variants may act through splicing rather than through protein sequence (observation, not my inference). Self-supervised genomic language models have since entered this space: SpliceBERT (Chen et al., 2024, *Briefings in Bioinformatics*) does zero-shot variant-effect-on-splicing prediction, and GPN-MSA (Benegas et al., 2025, *Nature Biotechnology*) scores genome-wide deleteriousness.

The target is **mechanism attribution**, for which splicing prediction alone is insufficient. Relevant prior art includes MutPred Splice (Mort et al., 2014), CADD-Splice (Rentzsch et al., 2021), and MOSAIC (Li et al., 2026). MOSAIC combines a DNA LM, CNNs and annotations and also reports interpretability analyses. These retrieved papers do not establish the exact signed PLM–gLM gate proposed here, but neither fusion nor mechanistic interpretation is itself novel. The bounded search did not identify an exact predecessor; this does not establish absence or priority.

## Novel hypothesis (single falsifiable claim)

> **For exonic single-nucleotide variants, a signed cross-modal disagreement statistic — the DNA language model's local embedding is strongly perturbed while the protein language model's residue likelihood is not — enriches for splicing-disruptive variants and retains a positive partial correlation with measured splicing outcomes after conditioning on a supervised splice oracle (SpliceAI/Pangolin).**

The claim is unsupported if held-out assay results do not show prespecified improvements over appropriate baselines. Non-significance alone is inconclusive, not proof of no effect; a sufficiently precise confidence interval excluding a preregistered useful effect can reject that effect. Splicing assays test splicing prediction, while mechanism classification additionally requires independent protein-function labels.

## Methods

Let a variant at genomic position $p$ define a reference window $s^{\text{ref}}$ and alternate window $s^{\text{alt}}$ of length $L$ nucleotides centred on $p$ (e.g. $L=512$, within a gLM's context). For coding variants, the affected codon translates a wild-type residue $a$ to mutant residue $b$ at protein position $i$.

**(1) Protein-modality disruption.** Using a masked protein LM $\phi$ (masked-marginal scoring, after Meier et al., 2021), define the residue log-likelihood ratio and its disruption magnitude:

$$s_P = \log p_\phi(x_i = b \mid x_{\setminus i}) - \log p_\phi(x_i = a \mid x_{\setminus i}), \qquad d_P = \max(0,\,-s_P).$$

A substitution disfavored by the model gives $s_P \ll 0$, hence large $d_P$; this is a model score, not a direct measurement of biochemical damage. For a **synonymous** variant the protein sequence is unchanged, so $d_P \equiv 0$ *by construction* (observation/definition, not assumption).

**(2) Genomic-modality perturbation.** Let $H_\theta(s)\in\mathbb{R}^{L\times d}$ be the final-layer per-token embeddings of a self-supervised gLM $\theta$. Over a local window $W=\{p-w,\dots,p+w\}$, define the mean cosine distortion:

$$d_G = \frac{1}{|W|}\sum_{j\in W}\Big(1 - \frac{\langle H_\theta(s^{\text{ref}})_j,\; H_\theta(s^{\text{alt}})_j\rangle}{\lVert H_\theta(s^{\text{ref}})_j\rVert\,\lVert H_\theta(s^{\text{alt}})_j\rVert}\Big).$$

$d_G$ measures how much a single nucleotide reshapes the local contextual representation. My *inference* — to be tested, not assumed — is that $d_G$ integrates learned splice-motif context (branchpoint, polypyrimidine tract, ESE/ESS), so a splice-disruptive change yields large $d_G$ even when $d_P$ is small.

**(3) Cross-modal disagreement gate.** Standardise each score against a background variant set $B$ (gnomAD common exonic variants, matched for within-exon position): $z_G=(d_G-\mu_G)/\sigma_G$, $z_P=(d_P-\mu_P)/\sigma_P$. Define the training-free splice-mechanism gate:

$$D_{\text{splice}} = \sigma\!\big(\alpha (z_G-\tau_G)\big)\cdot \sigma\!\big(-\beta (z_P-\tau_P)\big), \qquad \sigma(u)=\tfrac{1}{1+e^{-u}},$$

with sharpness $\alpha,\beta>0$ and thresholds $\tau_G,\tau_P$. $D_{\text{splice}}\in(0,1)$ is high when the gLM is strongly perturbed **and** PLM disruption is low. A signed companion $\Delta = z_G - z_P$ orders score disagreement; interpreting its sign as a biological mechanism requires independent validation. With fixed background scaling, synonymous variants all have the same $z_P$, making the gate a strictly increasing transformation of $d_G$ within that stratum: it cannot improve rank-based AUPRC over $d_G$ there. If the background is exclusively synonymous, $\sigma_P=0$ and standardization is undefined; such configurations must be rejected.

**(4) Evaluation — information beyond a supervised oracle.** Let $y$ be the measured splicing outcome in the assay's native units and $O$ a supervised splice oracle score (SpliceAI/Pangolin $\Delta$-score). A diagnostic statistic is the partial correlation of $D_{\text{splice}}$ with $y$, conditioned on $O$:

$$\rho_{D,y\cdot O} = \frac{\rho_{D,y} - \rho_{D,O}\,\rho_{y,O}}{\sqrt{(1-\rho_{D,O}^2)(1-\rho_{y,O}^2)}}.$$

The formula describes linear partial correlation, not general conditional information. Confirmatory analysis must preserve the oracle–outcome relationship in its null (for example, a justified residual-permutation design with gene-level exchangeability), compare held-out oracle-only and oracle-plus-gate predictions, and report paired gene-cluster confidence intervals. Unrestricted outcome permutation does not generally test the conditional null. MFASS positives must use its published splice-disrupting-variant definition, $\Delta$inclusion index $\le -0.5$, rather than replacing its measurement with $|\Delta\psi|$; Vex-seq uses its own assay endpoint. Precision@k $=\frac{1}{k}\lvert\{\text{true disruptors in top-}k\text{ by }D_{\text{splice}}\}\rvert$.

**Data & models.** gLM candidates: SpliceBERT, HyenaDNA (Nguyen et al., 2023, arXiv:2306.15794), GPN-MSA. PLM: ESM-2. Ground truth: MFASS (Cheung et al., 2019, PMID 30503770) and Vex-seq (Adamson et al., 2018, PMID 29859120). Oracle baselines: SpliceAI, Pangolin. Splits are by gene to prevent leakage; $\mu,\sigma,\tau$ are fixed on $B$ only.

## Scientific claims tree

- **T. Cross-modal PLM–gLM disagreement is a training-free classifier of splicing-mediated variant mechanism.**
  - **S1. A gLM's local embedding perturbation $d_G$ is elevated for splice-disruptive exonic variants.**
    - *Evidence:* gLMs already do zero-shot splice variant-effect prediction (SpliceBERT; observation from literature). *Assumption:* final-layer cosine distortion is a faithful proxy for that signal. *Test:* AUPRC of $d_G$ alone vs MFASS/Vex-seq labels; ablate window $w$.
  - **S2. A PLM's disruption $d_P$ is near-zero for splice-only variants.**
    - *Evidence:* $d_P\equiv0$ for synonymous variants by construction. *Assumption:* low PLM disruption identifies splice-only missense variants; the Pangolin observation does not establish this. *Test:* $d_P$ distributions with independent splice-only, protein-only, dual-effect, and neither-effect labels.
  - **S3. The AND-gate $D_{\text{splice}}$ beats either single-model saliency for splice-disruptor detection.**
    - *Assumption:* the two modalities' errors are partly independent. *Test:* paired AUPRC / precision@k, $D_{\text{splice}}$ vs $d_G$, vs $d_P$, vs $\Delta$.
  - **S4. $D_{\text{splice}}$ carries information beyond a supervised oracle.**
    - *This is the discriminating test.* *Test:* prespecified held-out improvement over oracle-only predictions, with valid conditional-null inference and uncertainty. A non-significant partial correlation alone establishes neither redundancy nor refutation.
  - **S5. On clinical VUS, high-$D_{\text{splice}}$ reclassifications concentrate in genes with known splicing-driven disease.**
    - *Assumption:* mechanism labels transfer from MRE assays to clinical loci. *Test:* enrichment of high-$D_{\text{splice}}$ ClinVar VUS in curated splicing-disease gene sets (held-out, hypothesis-generating only).

## Fact-check table

| # | Factual claim | Source (identifier) | Verdict |
|---|---|---|---|
| 1 | AlphaMissense predicts missense pathogenicity from a protein/structure model | Cheng et al., 2023, *Science* 381:eadg7492; PMID 37733863 | Supported |
| 2 | SpliceAI predicts splice junctions from primary sequence | Jaganathan et al., 2019, *Cell* 176:535–548; PMID 30661751 | Supported |
| 3 | Pangolin predicts splice-site strength; 5–10% of LOF missense may act via splicing | Zeng & Li, 2022, *Genome Biology* 23:103; DOI 10.1186/s13059-022-02664-4 | Supported |
| 4 | A nucleotide LM does zero-shot variant-effect-on-splicing prediction | SpliceBERT, Chen et al., 2024; DOI 10.1093/bib/bbae163 | Supported; pretrained on primary RNA sequences |
| 5 | A DNA LM scores genome-wide variant deleteriousness | GPN-MSA, Benegas et al., 2025; DOI 10.1038/s41587-024-02511-w | Supported; requires alignment inputs |
| 6 | DNA LM + CNN + annotation fusion targets splice-variant pathogenicity | MOSAIC, Li et al., 2026; DOI 10.1093/bib/bbag291 | Supported; includes interpretability analyses |
| 7 | ESM-2 is a protein LM used in ESMFold structure prediction | Lin et al., 2023, *Science* 379:1123–1130 | Distinguish the LM from the structure predictor; original DOI 10.1126/science.ade2574 |
| 8 | Masked-marginal scoring gives zero-shot mutation-effect predictions | Meier et al., 2021 (ESM-1v), NeurIPS | Proceedings identifier verified; predictions are not direct measurements |
| 9 | MFASS multiplexed exon-recognition assay quantifies large-effect splicing disruption | Cheung et al., 2019, *Mol Cell*; PMID 30503770 | Supported |
| 10 | Vex-seq measures variant impact on pre-mRNA splicing at scale | Adamson et al., 2018, *Genome Biology*; PMID 29859120 | Supported |
| 11 | HyenaDNA is a single-nucleotide long-context genomic LM | Nguyen et al., 2023, arXiv:2306.15794 | Supported |
| 12 | No published method uses signed PLM–gLM disagreement as a mechanism classifier | pubmed / consensus / web_search this session | Unverified-absence (searches found none; not exhaustive) |

## Figures / infographics plan

1. **Score-disagreement scatter.** Proposed data: MFASS and Vex-seq in separate assay panels. Encoding: x = $z_P$ (protein disruption), y = $z_G$ (genomic perturbation); point colour = measured effect in native assay units; marginal densities. Question: do splice-disruptors concentrate in the high-$z_G$/low-$z_P$ region? Protein-damaging comparisons need independent labels. No such pattern has yet been observed for this proposal.

2. **Incremental-information bar + PR curves.** Data: partial-correlation $\rho_{D,y\cdot O}$ with permutation null band; PR curves for $D_{\text{splice}}$ vs $d_G$, $d_P$, and oracle $O$. Encoding: bars with bootstrap CIs; overlaid PR curves. Reader conclusion: whether the gate adds signal *beyond* SpliceAI/Pangolin (the falsification test made visual).

3. **Clinical translation strip.** Data: ClinVar exonic VUS scored by $D_{\text{splice}}$. Encoding: ranked strip plot, top-$k$ annotated with gene and whether the gene is in a splicing-disease set. Reader conclusion: high-$D_{\text{splice}}$ VUS are candidate splicing-mechanism reclassifications for functional follow-up (hypothesis-generating, not diagnostic).

## Novelty assessment

**Verdict: candidate incremental framing; novelty and empirical value unestablished.** The bounded search identified relevant established components and prior work on mechanism interpretation, but no exact predecessor for this gate. $D_{\text{splice}}$ is nonnegative; only its companion $\Delta$ is signed. Neither has been demonstrated to classify mechanism.

Potential distinction to test: a fixed, interpretable contrast between protein and nucleotide scores. SpliceBERT predicts splicing effects; GPN-MSA predicts broader deleteriousness. MOSAIC includes mechanistic interpretation, and Pangolin already examines splice-mediated effects among missense variants. The absence of an exact search hit cannot establish that the proposal is new.

The discriminating claim (S4) may fail. A well-powered null result would constrain the proposal; an imprecise null would remain inconclusive. Before execution, the [audit](novelty-audit-2026-09-18.md) requires fixed model/input definitions, independent mechanism labels, stratified baselines, and a valid conditional test. Until then this is a research proposal, not a validated classifier or scientific novelty result.
