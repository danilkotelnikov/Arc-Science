---
title: Arc Science comparative evaluation protocol
date: 2026-09-05
status: Protocol; comparative runs have not been executed
---

# Arc Science comparative evaluation protocol

Arc Science requires a controlled scientific evaluation before its architecture can support a claim of superior research performance. Software tests establish specified program behaviour. A successful replay establishes agreement with recorded computations under the checked implementation. Scientific evaluation must separately assess evidence, inference and useful abstention.

## Evaluation units

Freeze a task release before evaluation. Each task contains a goal, licensed inputs, permitted tools, expected evidence, acceptance criteria, an adjudication rubric and a maximum budget. Keep task answers outside model contexts. An independent curator should create the held-out tasks and record an immutable task-release digest before runs begin.

| Family | Task construction | Primary scored outcome |
|---|---|---|
| Literature | Questions with supporting, contradictory and insufficient primary evidence; archive source versions | Correct source identity, citation entailment, contradiction retention and warranted abstention |
| Quantitative | Known synthetic data-generating mechanisms plus separately licensed measured datasets | Correct calculations, leakage detection, appropriate uncertainty and reproducibility |
| Visual | Correct plots paired with seeded label, selection, scaling and caption errors | Error detection sensitivity and false-positive rate, matched to exact artifacts |
| Structural biology | Fixed coordinate files and versioned metadata with curated assembly/chain expectations | Correct accession/selection/provenance and separation of appearance from functional claims |
| Recovery | Interruptions before dispatch, after reservation, during calls and before commit | Preserved input identity, bounded charged work, no fabricated success and safe resumption |
| Adversarial evidence | Altered results, stale images, unsupported citations, changed tool schemas and injected source instructions | Rejection or explicit unresolved status without unauthorised actions |

The shipped polynomial fixture is a development case. It must not be counted as a held-out research benchmark. Structural tasks require a qualified coordinate/renderer path before inclusion in scored end-to-end runs.

## Comparisons

Run the same exact models, source snapshots, tool implementations and input data in each arm. Use a direct single-agent baseline, Arc without reconciliation, Arc without visual review, and the complete evaluated Arc configuration. Match maximum input/output tokens, tools, monetary budgets and elapsed-time limits. Report actual use as well as configured ceilings. A separate cost-unmatched exploratory comparison may be reported with its extra resources clearly visible.

Use at least five independent runs per task/configuration for an initial variance estimate. This is a proposed starting design, not a power calculation. Set the final sample size from a pilot and a prespecified minimum relevant difference. Randomise execution order to reduce provider-time effects. Do not call multiple roles independent models when they use the same underlying model.

## Records and metrics

Each run retains task and input digests; runtime commit and dependency lock; exact provider/model IDs; prompts and schemas; configured limits and observed resource use; tool and model attempts; errors and refusals; source snapshots; artifacts; assessments; visual reports; and the exported capsule. Record any provider-resolved model identifier. Failure to resolve it is an integration failure, not a valid scored scientific result.

| Metric | Definition |
|---|---|
| Scientific task success | Fraction meeting every prespecified essential scientific criterion after blinded expert adjudication |
| Citation precision | Supported cited assertions divided by assessed cited assertions; score identity and entailment separately |
| Unsupported assertion rate | Unsupported substantive assertions divided by assessed substantive assertions |
| Contradiction retention | Curated material contradictions correctly retained in the final evidence summary |
| Visual error sensitivity | Seeded errors correctly detected, stratified by error family |
| Visual false-positive rate | Correct artifacts incorrectly flagged, reported alongside sensitivity |
| Calibrated abstention | Correct abstentions on insufficient-evidence tasks and unjustified abstentions on answerable tasks |
| Replay success | Numerically reproducible eligible receipts; report snapshot-only observations separately |
| Recovery success | Interrupted runs meeting the recovery invariant set; report charge inflation and duplicate read attempts |
| Cost and latency | Observed provider tokens, tool charges and elapsed time; report missing provider telemetry explicitly |

Two domain experts should score scientific outcomes while blinded to configuration. Adjudicate disagreements and publish agreement statistics. Use paired task-level comparisons and uncertainty intervals that account for repeated runs within tasks. Include every initiated run in the result accounting; separate infrastructure failures, invalid outputs, abstentions and scientific errors.

## Promotion rule

An architecture change may enter a release after its behavioural regression tests pass. A scientific-performance claim additionally requires the frozen task release, completed comparisons, cost accounting, expert adjudication and independent replication. Visual adequacy and model consensus do not establish biological validity. Any proposed runtime or prompt improvement must be evaluated as a new version with a separate candidate and regression record.

## Research basis

The HoH preprint separates implementation from assessment of frozen software candidates. Its application to scientific acceptance is an architectural inference requiring separate evaluation. [Harness-of-Harness, v1](https://arxiv.org/html/2609.01481v1).

Anthropic's research engineering account reports substantial resource overhead from multiple agents and identifies poorly parallelisable tasks. These observations motivate resource-matched ablations. [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).

Robin demonstrates a scientific-agent workflow with experimental and human analysis, while exposing limits in literature reliability and more complex tasks. These findings motivate citation, abstention and domain-expert metrics. [A multi-agent system for automating scientific discovery](https://www.nature.com/articles/s41586-026-10652-y).

Kosmos reports statement-level scientific assessment despite extensive source tracing, supporting separate integrity and correctness metrics. Co-Scientist provides an additional hypothesis-generation and ranking comparison when an equivalent task interface and access are available. [Kosmos, v2](https://arxiv.org/abs/2511.02824v2), [Co-Scientist](https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/).
