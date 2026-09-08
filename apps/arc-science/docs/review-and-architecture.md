---
title: Arc Science — implementation review and research architecture
date: 2026-09-04
status: Research prototype; independent scientific validation outstanding
scope: Life-science reasoning, multimodal review, reproducible figures, connectors, and controlled evolution
---

# Arc Science

## Executive decision

Build Arc Science as a scientific runtime with a small, independently testable acceptance kernel. Models should plan, interpret evidence, propose experiments and assess visual communication. Trusted services should control permissions, run calculations, bind results to inputs, enforce acceptance conditions and preserve a recoverable history.

The architectural opportunity is to couple three representations: the **execution graph**, the **scientific evidence graph**, and the **figure scene graph**. A changed source, assay, statistical assumption, molecular selection or claim must invalidate every dependent execution receipt, caption and visual annotation. The distinguishing product should be reproducible scientific work with explicit uncertainty and revocable acceptance.

The supplied files do not substantiate the previous “verified implementation” claim. The verification log says `BUILD FAILED`; the status JSON records a DNS-resolution failure with no completed steps. The claimed patch, source implementation and success marker were absent. A separate implementation report asserted success, but that assertion conflicts with the executable evidence. The existing GitHub code was therefore reviewed as an independent baseline, and a new isolated `arc-science` core was built and tested. It is not a verified migration of the entire Vedix repository.

## 1. Evidence reviewed and limitations

The local review inspected the supplied implementation report, integration guide, verification log and build-status JSON. The connected GitHub read API supplied the actual `plugins/vedix/mcp/lib/orchestrator/pipeline.py` implementation, including initialization, SGCA hooks, compilation, visual review and the top-level call chain. The inspected pipeline blob was `19962b83bb7afaba5505243524e077d7ffd0f38c`. [1]

The full legacy repository and claimed patch were not available locally. No repository-wide legacy tests were executed, and no remote commit or pull request was created. The new package has its own test suite, logs and source manifest. Its network tests exercise request construction and failure handling through an in-memory HTTP transport. They do not measure the reasoning ability of a live model.

A live BioRender search through the connected application succeeded and returned relevant public templates. This establishes that the connected application exposes useful operations; it does not transfer its authorization into a separately deployed Arc Science instance. Blender was not installed in the execution environment. The Blender worker was syntax-checked and its inputs and invocation were tested, but no Blender image was rendered.

## 2. Findings in the existing implementation

| Priority | Finding | Consequence | Required remediation |
|---|---|---|---|
| P0 | `_wrap_evaluator` returns `PASS` after exceptions and for unsupported evaluator return values. | Missing or broken verification can be accepted as success. | Return a blocking operational status; preserve the error category without leaking secrets. |
| P0 | The visible `run_full_pipeline` calls phases directly without invoking the declared SGCA graph-builder and sentence-verification path. | A documented hook or phase list does not establish enforcement. | One authoritative state machine; test its real execution path and denied transitions. |
| P0 | The top-level pipeline calls visual review but does not use its result as a terminal acceptance barrier. | Failed visual review can be followed by indexing, presentation generation and an ordinary summary. | Separate artifact creation from promotion; require a current candidate-bound decision. |
| P1 | `phase_0_init` assigns a new job identifier without rebuilding SGCA objects initialized under the earlier identifier. | The job and evidence stores can refer to different scopes. | Construct job-scoped dependencies after identity assignment; test repeated runs on the same object. |
| P1 | Compilation and Word export inspect file existence without checking command success or output freshness. | An old artifact may be mistaken for the current build. | Clean output locations, successful exit receipts and source/output hashes. |
| P1 | Visual review supplies figure paths and checks that a PDF exists; it does not establish that every manuscript page was rendered and seen. | Layout problems and missing figures can escape inspection. | Explicit all-page raster manifests and exact view coverage. |
| P1 | Critical question handling can return a default when callbacks are absent or fail. | User preferences and authorization decisions share unsafe fallback semantics. | Separate optional preferences from mandatory permission grants. |
| P1 | Independent reviewer stores are created with a comment that their earlier evidence work is assumed. | Separate namespaces alone do not establish independent evidence collection. | Require provenance-bearing reviewer input packets and actual acquisition receipts. |

These findings concern the inspected methods, not hypothetical behavior elsewhere in the repository. The top-level path and evaluator behavior were visible in source. Tests that replace every phase with a stub can verify call order but cannot establish scientific enforcement. [1]

### Claims that also need correction

A hash identifies bytes; it does not prove that those bytes are accurate. A controller-generated review commitment helps audit ordering but is not an independently signed attestation. Two provider names do not prove independent errors. A `strong_vision` flag is a configuration claim, not a benchmark result. OAuth authenticates delegated access; it does not authorize every scientific use of the resulting data. These distinctions must appear in API contracts and user-facing status labels.

Use `eligible_for_human_review`, `blocked`, `stale` and explicit uncertainty states. Avoid a blanket `publication_ready` status inferred from language-model scores.

## 3. Research findings as of 4 September 2026

Recent work changes the design in several useful ways. Most of the research below is recent preprint evidence. Improvements reported on coding, mathematics or poster benchmarks should not be assumed to transfer unchanged to life-science validity.

| Work or technology | Mechanism relevant to Arc Science | Adoption decision |
|---|---|---|
| **Harness-of-Harness**, September 2026 | Bounded planning–development–independent-QA cycles; artifact and evidence state persist; the underlying configuration remains fixed within a run. [2] | Adopt for artifact improvement. Keep scientific acceptance separate from software completion. |
| **Meta-Harness**, March 2026 | Optimize harness code using execution feedback and access to detailed traces. [3] | Use in an offline engineering track with regression suites and versioned candidates. |
| **Self-Harness**, June 2026 | Diagnose recurring weaknesses and test targeted harness modifications. [4] | Prefer small, attributable changes over unconstrained prompt rewrites. |
| **Adaptive Auto-Harness**, June 2026 | Maintain alternative harness configurations and route tasks rather than continually overwriting one global configuration. [5] | Build a portfolio for structure, omics, evidence synthesis and mechanistic modelling. |
| **Eureka**, August 2026 | Task-conditioned obligation graphs, incremental planning, specialized stateful execution units and governed evolution. [6] | Closely related prior art. Evaluate selected mechanisms; do not present dynamic obligation graphs as Arc Science’s original invention. |
| **Recursive Language Models** | Treat large external context as material that can be selectively inspected and decomposed. [7] | Add bounded, read-only context navigation over immutable evidence; do not expose unrestricted execution privileges. |
| **Anthropic advanced tool use** | Deferred tool discovery and programmatic coordination reduce unnecessary tool-schema context. [8] | Load capabilities by task and permission; retain individual call authorization and receipts. |
| **AutoDesign**, August 2026 | Iterative design optimization and design-specific evaluation for long-horizon poster creation. [9] | Use for layout search and visual critique, with scientific fidelity as a separate hard constraint. |
| **Crafter/CraftEditor**, May 2026 | Structured, semantically editable vector figures. [10] | Maintain an editable scene representation; generate quantitative content directly from data. |
| **MolecularNodes and Blender Gala** | Molecular representations in Blender and an additional publication-oriented presentation layer. [11,12] | Pin versions and validate atom/residue mappings before using aesthetic presets. |

The strongest direction is a **portfolio of qualified scientific workflows**, selected according to the task and revised between runs. Arc Science should not accumulate every new technique in one prompt. A feature enters the active runtime only after an ablation demonstrates its benefit at a controlled error rate.

Eureka is especially important for positioning: it already discusses a substantial part of the earlier obligation-graph proposal. Its correctness results depend on assumptions about leaf verifiers, composition, isolation and provenance. Arc Science cannot inherit those guarantees by using similar terminology. Its contribution needs an independently evaluated life-science implementation and stronger coupling between scientific claims and visual output. [6]

## 4. Architecture

### 4.1 Three coupled graphs

**Execution graph.** Describes actions, dependencies, alternatives, resource reservations, permissions and completion receipts. A node is completed by a trusted execution result, not by a model saying it has finished.

**Evidence graph.** Describes observations, hypotheses, assumptions, estimands, analyses, claims, objections, source scope and uncertainty. Evidence objects carry their origin, method, limitations and relevant experimental context.

**Scene graph.** Describes molecular objects, plots, panels, labels, legends, arrows, camera transforms, data encodings and export targets. Each scientific visual element points to evidence and each quantitative element points to a computation.

The graphs share stable identifiers and dependency edges but retain different semantics. A successful render does not make a causal hypothesis true. A statistically supported association does not authorize a causal arrow. A valid citation identifier does not establish entailment.

Consider an inhibition figure whose pocket panel contains an annotated hydrogen bond. If protonation, a ligand conformer or the underlying structure changes, the system should invalidate the interaction calculation, the annotation, any dependent mechanism statement and the relevant reviewer receipts. A neutral rendering can remain available while the disputed annotation is blocked.

### 4.2 Separate scientific execution from engineering evolution

The **scientific run** uses a pinned policy, model-seat registry, tool schemas, data snapshots and workflow versions. It may explore alternative hypotheses and methods within its authorization.

The **engineering run** studies execution failures, proposes skill or routing changes and evaluates them on development tasks. It cannot rewrite the active scientific run’s acceptance criteria. The next release can adopt a candidate only after independent testing and approval.

This separation allows autonomous improvement without permitting a failing agent to weaken its own examination.

### 4.3 Small trusted kernel

The kernel should own candidate identities, capability decisions, state transitions, evidence freshness and acceptance. Domain workflows and rendering engines remain replaceable. The initial prototype uses an explicit governor and a transactional ledger. A production deployment should move durable mission execution into a separately supervised workflow service and keep the acceptance kernel accessible only through authenticated service interfaces.

Cryptographic integrity requires a defined trust boundary. Content hashes and a local hash chain do not prevent a privileged administrator from rewriting both content and history. High-assurance deployments need signed service receipts, external anchoring, retention controls and key-management procedures.

## 5. Planning, concurrent routes and context

### 5.1 A bounded frontier

The planner maintains AND obligations and OR alternatives. It expands only enough of the frontier to keep available workers productive. Independent tasks can execute concurrently when declared read/write sets do not conflict. Shared scientific state is committed through a serialized or optimistic-concurrency-controlled boundary.

A failed route should leave unaffected alternatives available. A changed dependency reopens its descendants, while valid unrelated results remain usable. Repeatedly switching between nearly equivalent alternatives wastes context and compute; introduce switching hysteresis and explicit reasons for reopening a branch.

The prototype implements a deterministic greedy frontier, not an optimal proof-number or Monte Carlo tree-search system. It checks dependencies, alternatives, budgets and read/write conflicts. More advanced search belongs behind the same contract and must outperform this baseline.

### 5.2 Optimize cost under constraints

Use a constrained objective:

$$
\min_{\pi} \; \mathbb{E}[C(\pi)]
\quad\text{subject to}\quad
\operatorname{UCB}(\text{false acceptance}\mid\pi)\leq\epsilon,
\quad \text{mandatory checks pass},
\quad \text{permissions and budgets hold}.
$$

Here $\epsilon$ is a declared evaluation target and UCB is an uncertainty-aware upper bound estimated from held-out tasks. It is not an LLM-generated confidence score. Before enough evaluation data exist, use conservative rules and expose the uncertainty rather than displaying a fictitious probability.

Aesthetics, low latency or cheap tokens cannot compensate for invalid numerical evidence. Information-gain estimates can prioritize permissible experiments, but must not bypass a required verification step.

### 5.3 Decision-sufficient context

Each invocation should receive its current question, required assumptions, relevant source excerpts, strongest known counterevidence, unresolved checks and explicit completion conditions. A summarized neighboring branch includes the conditions that would make it relevant again.

Context reduction must preserve provenance and contradictions. The prototype retains all counterevidence within the caller-selected scope and fails when mandatory dependency closure exceeds the token budget. The caller still needs a trustworthy relevance policy and actual tokenizer counts. A token count supplied by an agent is not a resource measurement.

Cache keys include project, principal, policy, model, prompt, tool schema and source versions. Scientific evidence and tool observations are distinct from model response caches. A cached answer becomes stale when its dependencies change; it cannot silently regain acceptance through semantic similarity.

## 6. Strong vision models in the scientific cycle

### 6.1 Qualify by defect detection

Select vision models using blinded tests for small labels, panel swaps, misleading axes, crop ambiguity, ligand occlusion, chain misidentification, missing uncertainty markers, legend drift and caption mismatch. Evaluate false positives as well as missed defects. Requalify after model or transport changes.

The registry should point to the exact qualification report and its expiry. Family and provider labels help avoid obvious duplication but cannot establish independence by themselves. Measure paired errors on representative cases. The prototype enforces registry identity and expiry; the qualification study itself remains to be run.

### 6.2 Multi-scale visual evidence packets

A full research packet should include an overview, native-resolution panel crops, relevant legends, expected captions, approved claim statements, object-ID masks and geometric diagnostics. Molecular packets should add a neutral view, selected atoms/residues and explicit experimental/predicted/docked status.

The new transport sends image bytes rather than file paths and requires a hash-bound semantic brief. It checks exact view coverage, model identity and structured response validity. PDF rasterization explicitly covers every page or fails at a declared resource limit. Large packets still need an integration layer for tiled/batched review; the current client does not silently discard excess views.

A visual reviewer can identify that a label hides a ligand or that a caption contradicts its expected display. It cannot establish ligand binding, a biochemical mechanism or statistical validity from appearance. Numerical checks, structural selection validation and evidence entailment must remain separate.

### 6.3 Independent review and bounded improvement

The runtime sends isolated requests and records salted controller-side commitments before revealing completed reviews. This prevents ordinary review-to-review context leakage in the implemented controller. It does not constitute a distributed cryptographic trust system or prove that the controller itself is honest.

A rejected candidate can enter a bounded plan–build–retest cycle. The new implementation holds project, policy, producer identity and source artifacts fixed; repeated candidates are rejected; missing evaluation evidence blocks progress. Real deployment must also isolate builder and evaluator credentials and filesystems. Python callable separation alone cannot provide those security properties.

## 7. Structural biology rendering with Blender

### 7.1 Renderer recommendation

Use **MolecularNodes on a pinned Blender release** as the principal advanced 3D backend, with a browser molecular viewer for interactive inspection and a neutral scientific renderer for cross-checking. MolecularNodes offers the molecular representation layer. Blender Gala is a candidate publication-style extension, not a replacement for structural validation. [11,12]

The package delivered here provides a basic Blender worker for atomic instances and C-alpha traces. It preserves source coordinates and metadata but does not implement MolecularNodes, solvent-excluded surfaces, secondary-structure cartoons, automated biological assemblies or contact chemistry. Those capabilities must be added and tested before claiming publication-quality structural rendering.

### 7.2 Preserve scientific identity through rendering

The canonical structure record should retain deposited and normalized identifiers, model number, assembly choice, author and label chain/residue identifiers, insertion codes, alternate-conformer choice, occupancy, units and coordinate provenance. Keep a reversible map from rendered object IDs to those records.

Alternate-conformer selection must not assemble incompatible atomwise occupancy maxima. The new regression test exposed that error and the implementation now chooses a coherent residue-local alternate label while retaining shared blank atoms. This still does not establish correlations between alternates on different residues; explicit structure-specific selection is needed where those correlations matter.

No aesthetic operation may move atoms relative to one another. Apply a common, recorded transform to the molecular object, preserve handedness, and keep separate camera transforms. A docked pose must remain labelled as a prediction. The presence of a ligand in a structure does not by itself prove functional inhibition.

### 7.3 Evidence-coupled camera search

Generate camera candidates around the region of interest, render inexpensive previews, and score ligand visibility, contextual structure coverage, label space and occlusion. Preserve a mandatory neutral view so a visually attractive camera cannot conceal contradictory information.

The VLM can propose a different view or identify ambiguity. A deterministic scene service should apply permitted camera, lighting and label operations, then regenerate the visual receipts. Model suggestions to alter structural coordinates belong to a new scientific computation with separate authorization, not to figure polishing.

Render passes should include beauty, depth and object-ID outputs. Projected object masks support tests that labels do not obscure critical molecular regions. Shadows and silhouette treatment may improve clarity but should not introduce bonds, compartments or interactions absent from the underlying objects.

### 7.4 Reproducibility target

Archive the scene specification, source structure hash, selection map, camera matrix, renderer and extension versions, seed, samples, colour-management settings, environment identity and export manifest. Pin package/container artifacts rather than relying on version ranges alone.

Cross-GPU pixel identity is a stronger promise than scene reproducibility. Define exact comparisons for geometry and data, numerical tolerances where justified, and visual comparisons for final raster output. Publish which target a release satisfies.

## 8. BioRender MCP integration

BioRender’s official connector documentation, updated 28 August 2026, supports template search, own/shared figure search and custom first-draft figure creation with subsequent editing in BioRender. It does not establish an unrestricted asset-extraction or arbitrary SVG-export interface. [13]

Arc Science includes a standard MCP declaration using the endpoint also published in Anthropic’s life-science connector configuration: [14]

```json
{
  "mcpServers": {
    "biorender": {
      "type": "http",
      "url": "https://mcp.services.biorender.com/mcp"
    }
  }
}
```

The implemented client initializes the connection, discovers and pins tool schemas, validates call arguments and treats returned content as untrusted. Read-only search is the default. Metered creation and credit-finalizing session retrieval require exact-argument, single-use approval. Unknown or changed tool schemas block calls until reviewed. The deprecated confirmation action is denied.

This is a bounded, tested protocol subset. A production host should use the official MCP SDK where it needs complete transport and protocol behavior. The policy controls should wrap the SDK rather than disappear during migration.

Keep BioRender optional: a licensed illustration service and editor can enrich Arc Science, while data-driven plots and structural renders remain reproducible from their own sources. Store asset references, permissions and attribution. Do not build a proprietary template corpus by indiscriminately collecting previews. A live connection in this chat does not grant an Arc Science deployment credentials or consent.

## 9. OAuth, OpenClaw and execution boundaries

Separate user login, delegated connector access, model-provider authentication and worker identity. A deployed identity service must manage OIDC sessions and project roles; a credential broker must issue narrowly bound grants; compute workers must receive only their job inputs and allowed outputs.

MCP authorization specifies protected-resource discovery, authorization-server discovery, PKCE and resource-aware token handling. The new PKCE component covers bound, expiring, single-use transactions. It does not implement complete discovery, token exchange, encrypted refresh storage or a hosted callback service. Those belong in a mature identity/broker integration. [15]

OpenClaw’s Responses endpoint needs an explicit security boundary. The documentation warns of operator-level access, ignored compatibility fields and text-first PDF processing. A private broker must enforce permissions and a reviewer agent must have execution capabilities disabled by trusted configuration. A request field is not a security control unless the runtime implements it. [16]

OpenClaw also documents one trust boundary per gateway rather than hostile-tenant isolation. A new session alone does not prove reviewer isolation when an agent can access other sessions. Disable cross-agent session access and execution tools in reviewer configurations; use separate gateway cells for different trust boundaries. [16]

No model terminal sessions are needed: transport requests can be direct and stateless. A supervised noninteractive Blender or scientific-compute process is a separate category, launched with fixed executable contracts inside a sandbox. This distinction should appear in the threat model and audit log.

For production, require egress allowlists, URL/DNS controls, encrypted secrets, maximum payloads, cancellation, concurrency limits and cost reservations. Do not log bearer tokens or patient data. A timeout after an irreversible or metered action is an ambiguous outcome requiring reconciliation, not permission to retry blindly.

## 10. HeroUI application and figure compilation

Retain HeroUI v3 for the frontend. Its documented React/React Aria basis supports the accessible application surface. The frontend should edit typed scene and research objects rather than become their authoritative representation. [17]

Recommended views are Mission Control, Evidence Inspector, Parallel Routes, Figure Studio, Review Console and Connections. Figure Studio should synchronize a molecular viewport, vector composition canvas, data panel and evidence margin. Selecting an arrow should reveal the claim authorizing it; selecting a ligand should reveal its structure identifiers and pose status.

Use a canonical scene representation with explicit bounds, fonts, transforms, semantic roles, data references and licences. Compile it independently to SVG, raster, PDF and PowerPoint. Native PowerPoint labels, arrows and basic shapes can remain editable, while photorealistic molecular panels normally remain embedded rasters. Do not promise that converting an arbitrary HTML page into PPTX preserves both appearance and editability.

The present package contains rectangle/connector checks, not a full text-measurement engine or composition optimizer. Accurate glyph metrics, font availability, line breaking, export parity and layout solving remain required integration work. No HeroUI application was built in this delivery.

## 11. Controlled evolution and formal methods

Use separate development, tuning and sealed evaluation suites. Failure examples that feed the optimizer are training data. They must not also be described as an untouched final test. A final evaluator should withhold case-level feedback until the candidate and its policy are frozen.

An evolution proposal should contain a patch identity, declared affected capabilities, expected effect, regression results, protected-holdout receipt and approving identity. It cannot activate in the run that produced it. Changes to the acceptance kernel require a separate, higher-trust release process. The prototype implements these activation guards, not an autonomous theorem-proving system.

Formal methods are useful for finite control properties: a task cannot be accepted without required receipts; an expired lease cannot authorize a call; conflicting writes cannot both commit; a stale review cannot certify a new candidate. They do not automatically prove the scientific interpretation of a dataset. Model-check the workflow invariants and test their implementation correspondence; use scientific validation for empirical conclusions.

Avoid unrestricted self-modification of prompts, validators, permissions and benchmarks. Optimize one measured bottleneck at a time and retain rollback and candidate history. A new technique is justified by a controlled comparison, not by its recency.

## 12. Scientific evaluation and a credible state-of-the-art claim

Create an **Arc Science benchmark** with public development cases and a separately maintained protected evaluation set. Include structural rendering, omics reproduction, evidence synthesis, mechanistic modelling, export fidelity and authorization failure cases. Evaluate at the level of independent studies/tasks, not thousands of correlated labels counted as independent successes.

The primary safety metric should be critical false acceptance. Measure defect recall, false positives, reproducibility, uncertainty calibration, cost, latency and human revision effort. For figures, add molecular selection fidelity, view coverage, caption support, data-to-plot equivalence, editability and export geometry. Report uncertainty intervals and failure cases.

Compare the same underlying models and compute budgets across a single-model baseline, ordinary multi-review, a bounded HoH-style loop and the full graph-coupled runtime. Ablate context compilation, dynamic routing, VLM crops, independent checks and renderer feedback. A fair comparison must preserve task inputs, entitlement access and evaluator isolation.

Examples of seeded defects include swapped sample labels, duplicate biological units, omitted batch covariates, train/test contamination, an unsupported causal arrow, incorrect structure chain, missing ligand, incompatible alternate conformations, wrong scale bars and a valid but non-entailing citation. Keep the generated defects and their scientific labels under expert review.

A useful first public demonstration is a small-molecule/target figure package built from a real, legally accessible structure and assay dataset. Require source selection, quantitative reproduction, Blender and neutral renders, editable annotations, independent visual review and clean-environment regeneration. No supplied synthetic fixture should be presented as that demonstration.

## 13. Delivered implementation and release gates

The new core includes immutable contracts, a fail-closed governor, a hash-checked store, an idempotent event ledger, provider request adapters, bound visual briefs, isolated concurrent reviews, bounded improvement, PKCE transactions, a BioRender MCP client, all-page PDF rasterization, a basic Blender job, geometry checks, a greedy parallel frontier, context closure and cross-run evolution guards.

Verification results are in `evidence/verification.json` and `evidence/pytest-final.log`. They apply only to this package. They do not imply live OAuth completion, Blender execution, a production deployment, repository-wide compatibility or scientific benchmark superiority.

The next release gates are concrete:

1. Integrate the new governor into the actual legacy execution path and run the full legacy suite without phase stubbing at the critical acceptance boundaries.
2. Complete a production OAuth/token-vault deployment and live conformance tests for each provider and BioRender.
3. Run the Blender/MolecularNodes backend on real structural data and independently validate representation and identity mapping.
4. Build the HeroUI application and multi-format scene compiler; verify real typography and export parity.
5. Qualify model seats and evaluate the complete runtime on protected scientific tasks, followed by external review.

Arc Science 0.1.0 supplies a tested starting point for these gates. State-of-the-art performance remains a testable goal, not a property established by its architecture or test count.

## Sources

[1] Vedix source inspected through the connected GitHub API: [pipeline.py](https://github.com/danilkotelnikov/vedix/blob/master/plugins/vedix/mcp/lib/orchestrator/pipeline.py). Blob identity recorded above. Local input evidence: `vedix-vhoh-build-status.json`, `vedix-vhoh-verification.log`, and supplied implementation/integration documents.

[2] Yan et al. *Harness-of-Harness: Multi-Day Autonomous Software Development with Continual Improvement*. [arXiv:2609.01481](https://arxiv.org/html/2609.01481v1).

[3] *Meta-Harness*. [arXiv:2603.28052](https://arxiv.org/html/2603.28052v1).

[4] *Self-Harness*. [arXiv:2606.09498](https://arxiv.org/html/2606.09498v1).

[5] *Adaptive Auto-Harness: Sustained Self-Improvement for Agentic System Deployment on Open-Ended Task Streams*. [arXiv:2606.01770](https://arxiv.org/html/2606.01770v1).

[6] *Eureka: Task-Conditioned Meta-Agent Orchestration for Scientific Discovery*. [arXiv:2608.19047](https://arxiv.org/html/2608.19047v1).

[7] *Recursive Language Models*. [arXiv:2512.24601](https://arxiv.org/html/2512.24601v1).

[8] Anthropic. [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use).

[9] *AutoDesign: Meta-Harness Optimization for Long-Horizon Agentic Design*. [arXiv:2608.13560](https://arxiv.org/html/2608.13560v1).

[10] Crafter/CraftEditor research. [arXiv:2605.30611](https://arxiv.org/html/2605.30611v1).

[11] MolecularNodes. [Project source](https://github.com/BradyAJohnston/MolecularNodes), [API documentation](https://bradyajohnston.github.io/MolecularNodes/api/).

[12] Blender Gala. [Project documentation](https://maomlab.github.io/blender_gala/index.html).

[13] BioRender. [How to use the BioRender MCP connector](https://help.biorender.com/hc/en-gb/articles/30870978672157-How-to-use-the-BioRender-MCP-connector), updated 28 August 2026.

[14] Anthropic life-science connector configuration. [BioRender plugin](https://github.com/anthropics/life-sciences/blob/main/biorender/.claude-plugin/plugin.json).

[15] Model Context Protocol. [Authorization specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

[16] OpenClaw. [OpenResponses HTTP API](https://docs.openclaw.ai/gateway/openresponses-http-api) and [security trust model](https://docs.openclaw.ai/gateway/security).

[17] HeroUI. [React getting started](https://heroui.com/en/docs/react/getting-started).
