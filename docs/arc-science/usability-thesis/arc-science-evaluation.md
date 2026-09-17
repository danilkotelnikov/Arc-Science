---
title: Arc Science usability evaluation — bioinformatics thesis test
date: 2026-09-17
test_artifact: docs/arc-science/usability-thesis/thesis.md
---

# Arc Science usability evaluation

A usability/workflow test of Arc Science, using a genuinely novel small bioinformatics
thesis as the driving task ([thesis.md](thesis.md): *cross-modal PLM–gLM disagreement
as a training-free classifier of variant mechanism*). Scored 1–10 per axis with
evidence and the concrete gap. **What was runnable was run; what is credential-gated
is marked.**

## What I could and could not exercise

- **Ran:** Arc's numeric tools on thesis-shaped data; the figure/evidence/memory
  architecture inspected against the thesis structure; the demo mission decision-tree
  and its capture (from earlier).
- **Blocked (credential):** Arc's *live* scientific reasoning loop (planner /
  analyst / falsifier over a real hypothesis) needs a model seat, which is not
  configured here. So I evaluated the app's *support* for each axis and drove the
  deterministic parts, not a live mission on this thesis.

## Scores

| Axis | Score | Basis |
| --- | ---: | --- |
| Scientific claims tree | 8/10 | Arc's three coupled graphs — execution / **evidence** / scene — and the analyst↔falsifier reconciliation are a near-exact structural match for the thesis's T→S1…S5 tree (claim → sub-claim → *evidence vs assumption* → *test*). Arc **retains contradictions** rather than voting, which is exactly what S4's "may fail" claim needs. Gap: the graph is built from *mission observations*, not free-text; importing an authored claims tree needs a live mission or a new ingest path. |
| Fact-checking / provenance | 7/10 | Arc's discipline maps cleanly onto the thesis's fact-check table: `CaptionClaim.status ∈ {supported, hypothesis, simulation}` and `Check.status ∈ {pass, fail, unknown}` mirror the thesis's supported/partial/**unverified-absence** verdicts, and Arc forbids a supported claim without an evidence digest. Gap: Arc does not *fetch or verify* literature itself — the PMID/DOI checks here came from connectors (pubmed/consensus/arxiv), not Arc. Arc anchors provenance; it does not source it. |
| Math capability | 4/10 | **Ran live.** On synthetic D-vs-\|Δψ\| data, `execute_numeric` gave `describe_data` (n=80), a degree-1 fit (validation MSE **0.0117**, held-out split, self-labeled "not confirmatory"), and `permutation_control` (128 fixed-seed shuffles, mean shuffled MSE **0.0542** ≫ 0.0117 — the real link beats the null, honestly "not a p-value"). This genuinely supports the thesis's S4 permutation-null logic. Gap: the catalog is **three tools**; there is no partial-correlation (S4 conditions on a splice oracle), no PLM/gLM embedding compute, no arbitrary statistic. Arc is a *bounded, reproducible* calculator, not a general math engine. |
| Visual appearance | 6/10 | The workbench (now in a **native Rust window**, `arc-desktop`) is clean, accessible HeroUI, and the figure model separates structural identity from aesthetics and refuses to invent bonds/contacts. The figure pipeline renders molecular views, imports authorized vector figures, and plots deterministic numerical fits. Gap: the thesis's figures are *statistical scatter/PR/strip plots*; Arc's numerical renderer does fit/residual plots only — arbitrary data-plot rendering needs a plotting adapter. |
| Infographics | 4/10 | Arc can produce reproducible, provenance-bound *figures*, and its VLM figure-review can (credential-gated) check that a caption matches a panel and that labels don't hide a ligand. But it is not an infographic/layout tool: the thesis's "mechanism scatter" and "incremental-information" panels would need a data→plot adapter plus the multi-format scene compiler, which is not built. |
| Novelty checking | 2/10 | By design Arc is a figure/evidence workbench, **not** a literature engine. The novelty verdict for this thesis (novel framing, incremental components) came entirely from connectors + reasoning, not Arc. This is an honest scope boundary, not a defect — but if "check novelty" is a required workflow, Arc needs a literature-connector adapter feeding the evidence graph. |
| Format / output | 6/10 | Arc emits rigorous, reproducible artifacts — the **replay capsule** (frozen inputs + re-executable numeric code + hashes + `scientific_validation: not_established`) is a stronger provenance object than a thesis PDF. Gap: Arc does not author narrative prose or compile a thesis document; that stays a Markdown/authoring task outside the app. |

## Workflow verdict

The thesis and Arc Science share the **same epistemic backbone** — observation vs
assumption vs inference kept distinct, contradictions retained, "acceptance" meaning
*eligible for review* not *validated*, a permutation control that refuses to call
itself a p-value. That alignment is Arc's biggest usability strength: a scientist who
writes with this discipline will find Arc's graphs and capsules natural.

The biggest usability gaps for a bioinformatics thesis like this are, in order:

1. **Domain compute.** Three numeric tools cannot express PLM/gLM scoring, partial
   correlation, or AUPRC. A reviewed adapter catalog (the design already anticipates
   this) is the top gate.
2. **Literature into the evidence graph.** Novelty and fact-checking depend on
   connectors that Arc does not yet ingest as evidence nodes.
3. **Data→plot figures.** The figure pipeline renders structures and fits, not the
   statistical panels a methods thesis needs.
4. **Live reasoning is credential-gated**, so the headline loop (run this hypothesis
   through planner/analyst/falsifier) could not be exercised end to end here.

None of these are contradicted by the architecture; they are the "add a reviewed
adapter" and "provision a model seat" gates already named in the project's own docs.
For its *current* scope — reproducible figures with bound evidence and an auditable
decision tree — Arc handled the thesis's structure well; for *general bioinformatics
computation* it is early, and honestly says so.
