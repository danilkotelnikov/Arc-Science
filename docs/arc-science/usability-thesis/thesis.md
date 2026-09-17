# Cross-Modal Language-Model Disagreement as a Training-Free Classifier of Variant Mechanism

*Isolating splicing-mediated pathogenicity from protein-coding effects by contrasting a protein language model against a DNA language model*

## Abstract

Missense and synonymous exonic variants can be pathogenic through two distinct routes: they can alter the protein chemistry of the encoded residue, or they can disrupt *cis*-regulatory splicing elements (exonic splicing enhancers/silencers, branchpoints, cryptic sites) without any relevant change in protein chemistry. Current variant-effect predictors either score one axis (protein language models for missense chemistry; DNA/splicing models for splicing) or *fuse* modalities into a single pathogenicity score that maximises accuracy but collapses mechanism. I propose that the **signed disagreement** between a self-supervised protein language model (PLM) and a self-supervised DNA language model (gLM), computed without any task-specific training, is itself an informative, mechanistically interpretable signal. The core claim is falsifiable: a disagreement statistic that is high when the gLM's local representation is strongly perturbed but the PLM's residue likelihood is not will enrich for splicing-disruptive exonic variants, and will carry information about measured splicing outcomes *beyond* what a supervised splice oracle (SpliceAI/Pangolin) already provides. I define the statistic, three supporting equations, a claims tree with tests, a fact-check table over verified literature, and an evaluation on two existing multiplexed splicing assays (MFASS, Vex-seq). Honest verdict: **novel framing built from established components** (see final section).

## Background: the gap

Protein language models such as ESM-2 (Lin et al., 2023, *Science* 379:1123–1130) and the structure-aware AlphaMissense (Cheng et al., 2023, *Science* 381:eadg7492) predict missense effects from the protein axis. For a synonymous variant they are, by construction, silent, and for a missense variant that acts *through splicing* rather than through residue chemistry they are systematically mis-calibrated — the residue substitution may be chemically conservative even though the underlying nucleotide change destroys an exonic splicing enhancer.

On the other axis, supervised splicing models — SpliceAI (Jaganathan et al., 2019, *Cell* 176:535–548) and Pangolin (Zeng & Li, 2022, *Genome Biology* 23:103) — predict splice-site strength directly from DNA. Notably, Pangolin's authors *observed* that 5–10% of loss-of-function missense variants may act through splicing rather than through protein sequence (observation, not my inference). Self-supervised genomic language models have since entered this space: SpliceBERT (Chen et al., 2024, *Briefings in Bioinformatics*) does zero-shot variant-effect-on-splicing prediction, and GPN-MSA (Benegas et al., 2025, *Nature Biotechnology*) scores genome-wide deleteriousness.

The remaining gap is **mechanism attribution**, not accuracy. Given an exonic variant of uncertain significance (VUS), a clinician wants to know *why* it might be pathogenic — because fixing the wrong mechanism in the wrong model wastes the most informative signal. The closest prior work, MOSAIC (Li et al., 2026, *Briefings in Bioinformatics*), *fuses* a DNA LM, CNNs and annotations to maximise pathogenicity accuracy for noncanonical splice-altering variants. Fusion optimises prediction; it does not expose the protein-vs-splicing contrast. No published method (to my verification, below) uses the *disagreement* between an amino-acid-space model and a nucleotide-space model as a training-free mechanism classifier.

## Novel hypothesis (single falsifiable claim)

> **For exonic single-nucleotide variants, a signed cross-modal disagreement statistic — the DNA language model's local embedding is strongly perturbed while the protein language model's residue likelihood is not — enriches for splicing-disruptive variants and retains a positive partial correlation with measured splicing outcomes after conditioning on a supervised splice oracle (SpliceAI/Pangolin).**

The claim is refuted if, on held-out MFASS and Vex-seq variants, (a) the disagreement statistic does not separate large-effect splicing disruptors from matched non-disruptors above single-model baselines, **or** (b) its partial correlation with measured Δψ, conditioned on the splice oracle, is not significantly positive.

## Methods

Let a variant at genomic position $p$ define a reference window $s^{\text{ref}}$ and alternate window $s^{\text{alt}}$ of length $L$ nucleotides centred on $p$ (e.g. $L=512$, within a gLM's context). For coding variants, the affected codon translates a wild-type residue $a$ to mutant residue $b$ at protein position $i$.

**(1) Protein-modality disruption.** Using a masked protein LM $\phi$ (masked-marginal scoring, after Meier et al., 2021), define the residue log-likelihood ratio and its disruption magnitude:

$$s_P = \log p_\phi(x_i = b \mid x_{\setminus i}) - \log p_\phi(x_i = a \mid x_{\setminus i}), \qquad d_P = \max(0,\,-s_P).$$

A chemically damaging substitution gives $s_P \ll 0$, hence large $d_P$. For a **synonymous** variant the protein sequence is unchanged, so $d_P \equiv 0$ *by construction* (observation/definition, not assumption).

**(2) Genomic-modality perturbation.** Let $H_\theta(s)\in\mathbb{R}^{L\times d}$ be the final-layer per-token embeddings of a self-supervised gLM $\theta$. Over a local window $W=\{p-w,\dots,p+w\}$, define the mean cosine distortion:

$$d_G = \frac{1}{|W|}\sum_{j\in W}\Big(1 - \frac{\langle H_\theta(s^{\text{ref}})_j,\; H_\theta(s^{\text{alt}})_j\rangle}{\lVert H_\theta(s^{\text{ref}})_j\rVert\,\lVert H_\theta(s^{\text{alt}})_j\rVert}\Big).$$

$d_G$ measures how much a single nucleotide reshapes the local contextual representation. My *inference* — to be tested, not assumed — is that $d_G$ integrates learned splice-motif context (branchpoint, polypyrimidine tract, ESE/ESS), so a splice-disruptive change yields large $d_G$ even when $d_P$ is small.

**(3) Cross-modal disagreement gate.** Standardise each score against a background variant set $B$ (gnomAD common exonic variants, matched for within-exon position): $z_G=(d_G-\mu_G)/\sigma_G$, $z_P=(d_P-\mu_P)/\sigma_P$. Define the training-free splice-mechanism gate:

$$D_{\text{splice}} = \sigma\!\big(\alpha (z_G-\tau_G)\big)\cdot \sigma\!\big(-\beta (z_P-\tau_P)\big), \qquad \sigma(u)=\tfrac{1}{1+e^{-u}},$$

with sharpness $\alpha,\beta>0$ and thresholds $\tau_G,\tau_P$. $D_{\text{splice}}\in(0,1)$ is high only when the gLM is strongly perturbed **and** the PLM is not — the AND-gate that no fusion score exposes. A signed companion $\Delta = z_G - z_P$ orders variants along a mechanism axis ($\Delta\gg0$: splicing-dominant; $\Delta\ll0$: protein-coding-dominant).

**(4) Evaluation — information beyond a supervised oracle.** Let $y$ be the measured splicing outcome (e.g. $|\Delta\psi|$, change in exon inclusion) and $O$ a supervised splice oracle score (SpliceAI/Pangolin $\Delta$-score). The load-bearing test is the partial correlation of $D_{\text{splice}}$ with $y$, conditioned on $O$:

$$\rho_{D,y\cdot O} = \frac{\rho_{D,y} - \rho_{D,O}\,\rho_{y,O}}{\sqrt{(1-\rho_{D,O}^2)(1-\rho_{y,O}^2)}}.$$

The hypothesis is supported only if $\rho_{D,y\cdot O}>0$ under a label-permutation null ($p<0.05$) **and** $D_{\text{splice}}$ raises classification AUPRC over each single-model baseline. Classification positives are large-effect disruptors ($|\Delta\psi|\ge 0.5$ in MFASS); precision@k $=\frac{1}{k}\lvert\{\text{true disruptors in top-}k\text{ by }D_{\text{splice}}\}\rvert$.

**Data & models.** gLM candidates: SpliceBERT, HyenaDNA (Nguyen et al., 2023, arXiv:2306.15794), GPN-MSA. PLM: ESM-2. Ground truth: MFASS (Cheung et al., 2019, PMID 30503770) and Vex-seq (Adamson et al., 2018, PMID 29859120). Oracle baselines: SpliceAI, Pangolin. Splits are by gene to prevent leakage; $\mu,\sigma,\tau$ are fixed on $B$ only.

## Scientific claims tree

- **T. Cross-modal PLM–gLM disagreement is a training-free classifier of splicing-mediated variant mechanism.**
  - **S1. A gLM's local embedding perturbation $d_G$ is elevated for splice-disruptive exonic variants.**
    - *Evidence:* gLMs already do zero-shot splice variant-effect prediction (SpliceBERT; observation from literature). *Assumption:* final-layer cosine distortion is a faithful proxy for that signal. *Test:* AUPRC of $d_G$ alone vs MFASS/Vex-seq labels; ablate window $w$.
  - **S2. A PLM's disruption $d_P$ is near-zero for splice-only variants.**
    - *Evidence:* $d_P\equiv0$ for synonymous variants by construction; missense-via-splicing are chemically conservative (Pangolin observation). *Test:* $d_P$ distribution for splice-only vs protein-damaging labels.
  - **S3. The AND-gate $D_{\text{splice}}$ beats either single-model saliency for splice-disruptor detection.**
    - *Assumption:* the two modalities' errors are partly independent. *Test:* paired AUPRC / precision@k, $D_{\text{splice}}$ vs $d_G$, vs $d_P$, vs $\Delta$.
  - **S4. $D_{\text{splice}}$ carries information beyond a supervised oracle.**
    - *This is the discriminating test.* *Test:* $\rho_{D,y\cdot O}>0$ with permutation $p<0.05$; if it fails, the gate is redundant with SpliceAI/Pangolin and the thesis is refuted even if S1–S3 hold.
  - **S5. On clinical VUS, high-$D_{\text{splice}}$ reclassifications concentrate in genes with known splicing-driven disease.**
    - *Assumption:* mechanism labels transfer from MRE assays to clinical loci. *Test:* enrichment of high-$D_{\text{splice}}$ ClinVar VUS in curated splicing-disease gene sets (held-out, hypothesis-generating only).

## Fact-check table

| # | Factual claim | Source (identifier) | Verdict |
|---|---|---|---|
| 1 | AlphaMissense predicts missense pathogenicity from a protein/structure model | Cheng et al., 2023, *Science* 381:eadg7492; PMID 37733863 | Supported |
| 2 | SpliceAI predicts splice junctions from primary sequence | Jaganathan et al., 2019, *Cell* 176:535–548; PMID 30661751 | Supported |
| 3 | Pangolin predicts splice-site strength; 5–10% of LOF missense may act via splicing | Zeng & Li, 2022, *Genome Biology* 23:103; DOI 10.1186/s13059-022-02664-4 | Supported |
| 4 | A genomic LM does zero-shot variant-effect-on-splicing prediction | SpliceBERT, Chen et al., 2024, *Briefings in Bioinformatics* | Supported (DOI unverified this session) |
| 5 | A DNA LM scores genome-wide variant deleteriousness | GPN-MSA, Benegas et al., 2025, *Nature Biotechnology* | Supported (DOI unverified this session) |
| 6 | Multimodal *fusion* of a DNA LM + CNN + annotations targets splice-variant pathogenicity | MOSAIC, Li et al., 2026, *Briefings in Bioinformatics* | Supported — this is fusion, not disagreement (closest prior art) |
| 7 | ESM-2 is a protein LM giving atomic-level structure/effects | Lin et al., 2023, *Science* 379:1123–1130 | Supported (DOI 10.1126/science.ade2574, partial) |
| 8 | Masked-marginal scoring gives zero-shot mutation effects | Meier et al., 2021 (ESM-1v), NeurIPS | Partial (identifier unverified this session) |
| 9 | MFASS multiplexed exon-recognition assay quantifies large-effect splicing disruption | Cheung et al., 2019, *Mol Cell*; PMID 30503770 | Supported |
| 10 | Vex-seq measures variant impact on pre-mRNA splicing at scale | Adamson et al., 2018, *Genome Biology*; PMID 29859120 | Supported |
| 11 | HyenaDNA is a single-nucleotide long-context genomic LM | Nguyen et al., 2023, arXiv:2306.15794 | Supported |
| 12 | No published method uses signed PLM–gLM disagreement as a mechanism classifier | pubmed / consensus / web_search this session | Unverified-absence (searches found none; not exhaustive) |

## Figures / infographics plan

1. **Mechanism scatter (the money figure).** Data: MFASS + Vex-seq variants. Encoding: x = $z_P$ (protein disruption), y = $z_G$ (genomic perturbation); point colour = measured $|\Delta\psi|$; marginal density on each axis. Reader conclusion: splice-disruptors populate the high-$z_G$/low-$z_P$ quadrant — the region $D_{\text{splice}}$ gates — while protein-damaging variants sit on the opposite diagonal.

2. **Incremental-information bar + PR curves.** Data: partial-correlation $\rho_{D,y\cdot O}$ with permutation null band; PR curves for $D_{\text{splice}}$ vs $d_G$, $d_P$, and oracle $O$. Encoding: bars with bootstrap CIs; overlaid PR curves. Reader conclusion: whether the gate adds signal *beyond* SpliceAI/Pangolin (the falsification test made visual).

3. **Clinical translation strip.** Data: ClinVar exonic VUS scored by $D_{\text{splice}}$. Encoding: ranked strip plot, top-$k$ annotated with gene and whether the gene is in a splicing-disease set. Reader conclusion: high-$D_{\text{splice}}$ VUS are candidate splicing-mechanism reclassifications for functional follow-up (hypothesis-generating, not diagnostic).

## Novelty assessment

**Verdict: novel framing, incremental components.** Every ingredient is established — masked-marginal PLM scoring, gLM embedding saliency, supervised splice oracles, MRE ground truth. The novelty is the *object of study*: the signed disagreement $D_{\text{splice}}$ / $\Delta$ used as a **training-free mechanism classifier**, not another fused accuracy score.

Reasons it is not "already done": prior genomic LMs (SpliceBERT, GPN-MSA) predict splicing *effect*, not the protein-vs-splicing *contrast*; multimodal methods (MOSAIC, AlphaMissense's hybrid) *fuse* modalities, which by design discards the disagreement this thesis exploits; Pangolin *observed* the splicing-via-missense phenomenon but attributes it with a supervised splice model alone.

Reasons it is not a large leap: the discriminating claim (S4) may fail — a well-trained gLM saliency could be largely redundant with SpliceAI, in which case the contribution collapses to an interpretability wrapper. That risk is exactly why S4 is written as the falsification test rather than as an assumed result. The honest characterisation is a small, decisively testable methodological hypothesis at the protein-LM / genomic-LM frontier, worth running precisely because a null result is as informative as a positive one.
