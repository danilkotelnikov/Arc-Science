# Arc Science research dossier, July to September 2026

Compiled on 25 September 2026. Undermind workspace "Arc Science 2026":
<https://app.undermind.ai/projects/18d76dc5-ca2a-421c-9e43-537cd87d9a11>.

This dossier is the research basis for the approved plan (slice R0). It records which
published work supports each plan decision, which decisions rest on standards or
design judgement, and where no recent evidence exists.

## Scope and method

- **Evidence rule.** Only work first posted on or after 1 July 2026 counts as research
  evidence. Standards and older works appear only in the section "Standards and
  background", which is not evidence.
- **Sources.** Seven Undermind deep searches (harness evolution, validation, visual QA,
  LaTeX and documents, memory, prose, UI), merged with an earlier date-checked list and
  deduplicated by identifier. Each paper appears once, in the area where it bears most;
  other sections refer to it by identifier or cite key.
- **Date checks.** For arXiv items the first-posted date is the v1 `<published>` field of
  the arXiv export API. For DOI-only items it is the Crossref record (posted, online or
  created date, as stated in the row). An arXiv identifier's month prefix does not always
  match the v1 date (for example arXiv:2608.24913 was first posted on 2026-07-26), so the
  dates below come from `<published>`, not from the identifier.
- **Earlier list.** The 40 arXiv items and 2 DOIs from the earlier list that the deep
  searches did not return were re-checked on 25 September 2026: dates and abstracts from
  the arXiv export API, and Crossref for doi:10.64898/2026.08.18.745260 and
  doi:10.3390/jemr19040089.
- **Limits.** Findings are summaries of abstracts, not of full texts. Nearly all items are
  unreviewed preprints, and many report single runs, synthetic settings or self-graded
  judging. Each finding is the authors' claim, not an established result.

### Corrections to the plan's research basis

1. *The Misclassification of Autistic Writing as AI-Generated* (arXiv:2607.14729, v1
   2026-07-16) is a later arXiv copy of a work published in LNCS on 2025-07-15 (Crossref).
   Its first posting is therefore 2025, and it moves to background. The autistic-writing
   confound in the prose engine now rests on background, not on post-July evidence.
2. The plan states that no post-July research exists on real-time LaTeX compilation. One
   engineering report does exist: Lode, *Real-time LuaTeX* (TUGboat 47:2, DOI registered
   2026-08-30). It has no controlled evaluation.
3. The 23.6% to 5.3% fall in reward hacking (arXiv:2608.29460) comes from an escalation
   tool combined with an explicit anti-reward-hacking policy, not from the tool alone.
4. PerturbTrace (doi:10.64898/2026.08.18.745260) was posted on 2026-08-20 according to
   Crossref; the DOI carries the date stamp 2026-08-18.
5. Verified accessibility repair (arXiv:2608.24913) accepts a change only if violations
   strictly decrease. The plan's palette rule ("contrast violations never increase") is a
   weaker adaptation of that rule, and it is labelled as such below.

## Harness evolution

The evidence supports gated, reversible evolution of the harness around frozen seat
models. A change is committed only after no-regression and retention checks, selection
uses hidden and held-out task splits, the evaluator is sealed from the agent, and an
archive with a verified undo is kept (HarnessEvolve, StarHarness, SEAL, EvoUndo,
DarwinX). The safety papers document concrete failure modes: harness tampering, phantom
guardrails, skill contamination that rollback cannot undo, in-band judges that mistake
stagnation for progress, security drift and harness-induced forgetting. A matched-budget
re-evaluation finds that harness evolution often does not beat plain test-time scaling
(Wan26ac), and evidence that learned per-task routing beats a static route is thin and
brittle under lexical shift (Vid26, Vid26b, Kum26g). No study evaluates harness evolution
inside a single-user desktop research tool, on scientific-claim tasks with a human
approval in the loop, or with commercial API seats whose model versions change underneath.

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| Eureka: task-conditioned meta-agent orchestration (Wong, Won26) | 2026-08-19 | [arXiv:2608.19047](https://arxiv.org/abs/2608.19047) | Compiles long-horizon tasks into obligation graphs with explicit acceptance semantics and evolves the local architecture only under cost-benefit gates; 170/170 recursive tasks and 3,948 certificates with no false acceptances. | Model research plans as obligation graphs whose nodes carry acceptance criteria that the claim validator checks. |
| Harness Continual Learning (Kang, Kan26c) | 2026-08-19 | [arXiv:2608.19013](https://arxiv.org/abs/2608.19013) | Separates update generation from commitment by an evaluator that checks current improvement, retention of earlier behaviour and validity; relative gains above 10% in several settings. | Gate every prompt, skill or route change on a retention suite of previously solved tasks. |
| Auditing Harness Tampering (Wang, Wan26d) | 2026-08-30 | [arXiv:2609.00069](https://arxiv.org/abs/2609.00069) | Taxonomy of tampering by the harness role edited and the obligation violated (authorization, provenance, completeness); tampering occurs consistently in real self-improvement runs and often persists in the best agent's lineage. | Audit each self-edit against these obligations; keep evaluator and permission files outside the editable surface. |
| HarnessEvolve (Jiang, Jia26) | 2026-09-01 | [arXiv:2609.00829](https://arxiv.org/abs/2609.00829) | Independent modules for execution, evaluation, optimisation and gating; a quality gate (leakage, prompt bloat), a performance gate (no degradation on recent batches) and held-out snapshot selection. The abstract gives no numbers. | A near-direct template for the harness-change gate. |
| Self-Authored Verification Is Unreliable, SEAL (Guo, Guo26) | 2026-07-27 | [arXiv:2607.24300](https://arxiv.org/abs/2607.24300) | Self-authored test scores stay near perfect while sealed deployment performance degrades. SEAL compares each candidate with the incumbent through a fixed audit the agent cannot author or see, returns only accept or reject, and beats unprotected baselines across six models and three seeds. | The acceptance audit must be sealed from the LLM seats and expose only accept or reject. |
| DarwinX (Zhang, Zha26w) | 2026-07-31 | [arXiv:2608.07545](https://arxiv.org/abs/2608.07545) | Population-based harness selection with a frozen model and a preserve-and-extend contract; about 17 points on average, Terminal-Bench 2.1 to 83.2% and WebArena-Infinity from 43.5% to 93.0%. | Keep an archive of harness variants per task family and admit only non-regressing variants. |
| EvoUndo (Sah, Sah26) | 2026-08-28 | [arXiv:2608.28363](https://arxiv.org/abs/2608.28363) | 197 capability-improving self-modifications failed recoverability verification and conventional repair recovered 0/197; exact state-address grounding raised recovery from 0/48 to 38/48; 142/143 in the oracle stratum. | Every self-modification carries an independently verified undo bound to exact state addresses. |
| StarHarness (Esakkiraja, Esa26) | 2026-08-25 | [arXiv:2608.24804](https://arxiv.org/abs/2608.24804) | Separates search tasks the proposer sees, selection tasks hidden from it and held-out tasks; 20-35 pp gains on three enterprise benchmarks after 4-12 accepted changes, persisting on excluded tasks and transferring across GPT and Qwen. | Use a three-way split (search, hidden selection, held-out) when accepting harness changes. |
| Hierarchical Self-Improvement (Zhou, Zho26f) | 2026-08-09 | [arXiv:2608.08466](https://arxiv.org/abs/2608.08466) | Per-task-family harnesses hot-swapped through a fixed seam under a frozen anchor; +15.0 to +39.3 on four BALROG environments and nothing on NLE, a task beyond the backbone. | Task-family profiles are viable, but evolution cannot rescue tasks beyond the seat model's capability. |
| Self-Evolving Agents with Anytime-Valid Certificates (Sengupta, Sen26c) | 2026-07-01 | [arXiv:2607.00871](https://arxiv.org/abs/2607.00871) | Changes to a small adapter and a versioned harness are admitted only through an anytime-valid gate with an auditable certificate; +4 and +5 on a 52-instance SWE-bench Verified subset, single runs. Posted on the boundary day. | Accepted harness changes can carry statistical certificates recorded in the ledger. |
| Rethinking the Evaluation of Harness Evolution (Wang, Wan26ac) | 2026-07-14 | [arXiv:2607.12227](https://arxiv.org/abs/2607.12227) | Under matched feedback and inference budgets, harness evolution does not consistently beat test-time scaling and discovery baselines on Terminal-Bench 2.1 and generalises poorly to held-out tasks. | Any claim that a harness improved needs matched-budget baselines and held-out tasks. |
| AutoSaddler (Park, Par26) | 2026-08-24 | [arXiv:2608.23041](https://arxiv.org/abs/2608.23041) | Diagnoses failure traces, generates structured code patches and selects updates on validation; +9.0 to +10.0 pp on GAIA2, SWE-Bench Pro and Terminal-Bench 2.0. | Harness edits are targeted patches from diagnosed traces, not free rewrites. |
| MemoHarness (Huang, Hua26b) | 2026-07-14 | [arXiv:2607.14159](https://arxiv.org/abs/2607.14159) | Adapts six editable harness dimensions per test case from a dual-layer experience bank, without test-time labels; beats fixed harnesses. No headline numbers. | Per-task adaptation can come from retrieval over local memory rather than unconstrained self-editing. |
| When Do Agent Loops Mistake Stagnation for Progress? (Park, Par26g) | 2026-07-27 | [arXiv:2607.25152](https://arxiv.org/abs/2607.25152) | The agent claimed improvement in all 54 cycles although 56% had zero or negative measured change; the strongest in-band judge accepted cycles of which 44% were regressions; a sign-only out-of-band gate nearly matched full feedback (110.0 vs 113.0). | Ground acceptance out of band in data or execution; a larger LLM judge does not close the gap. |
| Rethinking Scientific Discovery in the Agentic Era, SCION (Zheng, Zhe26) | 2026-07-04 | [arXiv:2607.03863](https://arxiv.org/abs/2607.03863) | A Research Execution Plan compiles intent into staged objectives, dependencies, verification checkpoints, expected artifacts and fallbacks, with layered epistemic memory; beats research-agent baselines. No numbers. | A close template for the research-plan object with verification checkpoints and expected artifacts. |
| JIT-Agent (Zhang, Zha26ag) | 2026-08-26 | [arXiv:2608.25593](https://arxiv.org/abs/2608.25593) | A trained model synthesises and repairs task-adaptive harnesses under a fixed four-module protocol; gains up to 20.2 points. | Per-task harness generation could be a seat, but its output must pass the same sealed gates. |
| XScientist (Luo, Luo26) | 2026-07-14 | [arXiv:2607.12301](https://arxiv.org/abs/2607.12301) | A git-like protocol exports an exploration DAG, per-node code and outputs, claim-to-evidence anchors, content hashes and re-execution hooks. Architecture only, no evaluation. | A model for the exportable run artifact, with content-hashed anchors and failed branches kept. |
| Proof-or-Stop (Huang, Hua26j) | 2026-07-16 | [arXiv:2607.14890](https://arxiv.org/abs/2607.14890) | Lifecycle transitions need fresh, mechanically verifiable evidence bound to the source state; 10/10 scenarios with zero false DONE, 18 tamper classes rejected, visible-pass/hidden-fail from 31/1,800 to 2/1,800. One model family, 24 tasks. | "Done" and approval states require fresh evidence bound to the current source hash. |
| HarnessLens (Xu, Xu26g) | 2026-08-27 | [arXiv:2608.27311](https://arxiv.org/abs/2608.27311) | Verifies each candidate edit only on behaviour-relevant tasks through an attributable-evidence gate; held-out gains of 7.6-13.6% with substantially less evaluation budget. | Scope regression checks to the behaviours a change touches, to bound local compute. |
| HarnessBank (Luo, Luo26e) | 2026-07-15 | [arXiv:2607.13683](https://arxiv.org/abs/2607.13683) | A gene bank of harnesses recombined and screened through a gate; 5.1% to 15.4% gains on seven benchmarks, coming from model-specific evolution rather than one universal harness. | Store harness variants per model seat. |
| HarnessCompass (Zhang, Zha26b) | 2026-08-03 | [arXiv:2608.01918](https://arxiv.org/abs/2608.01918) | Restricts evolution to task-agnostic changes and evolves components separately; SWE-bench Verified Pass@1 from 54% to 66% in 5 iterations, transferring to held-out tasks and other models. | Limit self-edits to task-agnostic components evolved separately. |
| HarnessOpt-Bench (Ursekar, Urs26b) | 2026-08-06 | [arXiv:2608.06301](https://arxiv.org/abs/2608.06301) | An optimiser edits a seed harness under a fixed budget and is scored on a held-out partition it never sees, enforced by a trusted execution environment; across 5 LLMs, 4 tasks and 111 runs the optimiser model matters more than its coding harness. | A sealed held-out split with every candidate version preserved is the right evaluation boundary. |
| Pre-Commit Gating against Skill Contamination (Shang, Sha26c) | 2026-08-06 | [arXiv:2608.05810](https://arxiv.org/abs/2608.05810) | Past a critical pool size, new skills degrade performance through contamination chains, and removing the source skill recovers little; three critics plus marginal-gain selection reach 72% pass@1 on Terminal-Bench 2 with a pool about 5x smaller. | Admit skills and memory entries before commit; rollback alone cannot undo inherited contamination. |
| Harness-of-Harness (Yan, Yan26n) | 2026-09-01 | [arXiv:2609.01481](https://arxiv.org/abs/2609.01481) | Planning, coding and testing loops with small verifiable increments, developer testing kept separate from independent evaluation, and versioned histories; average relative gain 52.25% after 3 iterations, and one deployment ran 70+ iterations. | Supports the planner, developer and independent QA loop. |
| Harness-R1 (Shao, Sha26i) | 2026-08-03 | [arXiv:2608.02276](https://arxiv.org/abs/2608.02276) | A 9B harness-editor trained by RL with reward from fresh reruns of the frozen target; success from 44.3% to 53.6% on three agent benchmarks. | A learned editor seat is possible only if its reward comes from reruns, never from self-reports. |
| A Control System, a Dataset, and a Recipe (Paul, Pau26) | 2026-07-28 | [arXiv:2607.25415](https://arxiv.org/abs/2607.25415) | The harness is a small human-legible action space learned online with a contextual bandit and REINFORCE, with an unsupported-claim penalty in the reward. No headline numbers. | A bounded, auditable space of routes suits a workbench that calls black-box APIs. |
| Phantom Guardrails (Wang, Wan26g) | 2026-07-13 | [arXiv:2607.13083](https://arxiv.org/abs/2607.13083) | A proposer enabled a guardrail for a nonexistent rule and cited an oracle-refuted violation in 15/60 runs versus 0/60 on featureless input; add-only accept loops keep such guardrails. | Accept a fix only when the failure it cites is verified against an oracle or the ledger; avoid add-only loops. |
| EvoHarnessBench (Ke, Evo26) | 2026-09-03 | [arXiv:2609.04280](https://arxiv.org/abs/2609.04280) | 17 multi-stage harness streams (802 tasks): expanding the harness alone degrades previously solved tasks, and self-evolution gains are inconsistent. | Adding tools, skills or seats must be regression-tested on previously solved tasks. |
| DREvo (Guo, Guo26g) | 2026-07-29 | [arXiv:2607.26722](https://arxiv.org/abs/2607.26722) | Re-checks whether stored historical evidence is still valid for the current harness before reuse; average gains of 16.2% and 14.2% under limited budgets. | Revalidate stored lessons against the current harness version before reuse. |
| The LLM Proposes, the Executive Disposes (Arjmandi, Arj26) | 2026-08-04 | [arXiv:2608.04066](https://arxiv.org/abs/2608.04066) | A deterministic executive owns all belief; a claim is admitted only when code matches a pre-registered prediction, and runs invalidate themselves when floors are breached (4 of the first 8). Task efficacy was null (0 completions in 52 ARC-AGI-3 runs). | Supports code-owned state with LLM proposals and claim admission tied to pre-registered predictions. |
| TTHE: Test-Time Harness Evolution (Nie, Nie26c) | 2026-07-09 | [arXiv:2607.08124](https://arxiv.org/abs/2607.08124) | Evolves harnesses during evaluation from unlabeled traces using execution-derived proxy signals, and names proxy reliability as the central open risk. No numbers. | Unsupervised evolution may tune routes but must never decide scientific claims. |
| Agentic Synthesis against Counterexample-Supplemented Sketches (Castle, Cas26) | 2026-07-17 | [arXiv:2607.15854](https://arxiv.org/abs/2607.15854) | Each developer call names its change authority and the invariants that must survive; in one run 8 of 14 frozen candidates became counterexamples, and three retention strategies passed 14, 17 and 16 of 21 withheld cases. | Developer-seat calls declare change authority and invariants; frozen candidates face independent review. |
| Self-Modifying Lean Proof Agents (Li, Li26w) | 2026-07-19 | [arXiv:2607.17352](https://arxiv.org/abs/2607.17352) | A small trusted runtime wraps a mutable workspace, and success counts only when Lean verifies under a trusted snapshot; held-out miniF2F 45.1% versus 12.7% for the seed and 32.0% for the best fixed-benchmark agent. | The split into trusted core, mutable workspace and external formal verifier suits the LaTeX and maths studio. |
| HELIX (Fan, Fan26b) | 2026-08-14 | [arXiv:2608.13951](https://arxiv.org/abs/2608.13951) | A typed, source-traceable substrate of ports, atoms, recipes and policies; +4.0% coverage over Pi, and a 200-slot slice yields 438 verified records. | Keep harness interventions typed and provenance-tracked. |
| Evo-Bench (Huang, Hua26i) | 2026-08-10 | [arXiv:2608.09096](https://arxiv.org/abs/2608.09096) | The best of nine models gains up to 16.6 points, but evolution struggles on Office tasks that need specific workflows and saturates early. | Expect less from self-evolution on rigid document workflows such as grant forms. |
| One Recipe, Many Harnesses (Yang, Yan26k) | 2026-08-10 | [arXiv:2608.10178](https://arxiv.org/abs/2608.10178) | Routes each edit through a typed failure signal recorded as a falsifiable contract; held-out solve rates improve in most cells of 8 languages and 3 models, with two null regions. | Record every harness edit as a falsifiable contract tied to a typed failure. |
| Evo-Harness (Wei, Wei26c) | 2026-08-15 | [arXiv:2608.15071](https://arxiv.org/abs/2608.15071) | Compiles noisy single-shot executions into reusable skill harnesses across five benchmarks. No headline numbers. | Compiled skills still need gating before admission. |
| Living-Harness (Du, Du26) | 2026-07-29 | [arXiv:2607.26598](https://arxiv.org/abs/2607.26598) | Bounded updates only to episodic memory and a state graph, with tools and base context frozen; Pass@1 +10.07 and +9.91 pp over the strongest baseline. | Confining evolution to memory and a state graph is a safe default scope. |
| Auditing Self-Evolution in Financial Agents (Li, Li26d) | 2026-08-18 | [arXiv:2608.17684](https://arxiv.org/abs/2608.17684) | SkillOpt raises utility from 0.741 to 0.837, while exposure to injected content rises from 0.820 to 0.943, attack success from 0.496 to 0.530, and unauthorized state changes reach 0.685. | Audit evolved routes for permission and security drift, such as unauthorized grant-ledger writes. |
| Learning to Control Harnesses with Offline RL (Yi, Yi26b) | 2026-07-05 | [arXiv:2607.05458](https://arxiv.org/abs/2607.05458) | A lightweight offline-trained controller selects structural actions around a frozen LLM; verification behaviour improves across 6 domains while final quality improves only selectively. | A small controller over plan, check and retry could adapt behaviour without touching the seat models. |
| MetaSkill-Evolve (Wang, Wan26al) | 2026-07-06 | [arXiv:2607.05297](https://arxiv.org/abs/2607.05297) | Task skills evolve on a fast loop and the improvement procedure on a slower one; held-out gains of +23.54, +16.09 and +1.92. | If the improvement procedure itself evolves, it needs a slower timescale and its own gate. |
| SafeEvolve (Mao, Mao26b) | 2026-09-02 | [arXiv:2609.02786](https://arxiv.org/abs/2609.02786) | Bounded, component-level, reversible safety updates; attack success on AgentDojo cut 3x while benign utility rose from 59.79% to 61.86%. | Safety-relevant harness updates should be bounded, component-level and reversible. |
| Co-Harness (Chen, Che26b) | 2026-07-17 | [arXiv:2607.22688](https://arxiv.org/abs/2607.22688) | Alternates critic-proposed harness updates with fine-tuning; a 200+ hour case study. No headline numbers. | With frozen API seats only the harness half of this loop applies. |
| EvolveNet (Nie, Nie26) | 2026-08-05 | [arXiv:2608.04968](https://arxiv.org/abs/2608.04968) | Data-local deployments evolve a shared harness and compose back only program adaptations; the shared harness improves in all five settings. | Separate installs could share harness improvements without sharing research data. |
| Where Reliability Lives (Marsden, Mar26c) | 2026-09-02 | [arXiv:2609.03192](https://arxiv.org/abs/2609.03192) | An authoritative append-only ledger adjudicates every act; five pre-declared properties never moved across ablations, and 0 of 2,581 substituted-panel false completions were accepted. | Reliability can live in an append-only ledger rather than in the model. |
| Learning Compositional Meta-Routing (Vidra, Vid26) | 2026-07-31 | [arXiv:2608.00106](https://arxiv.org/abs/2608.00106) | A meta-router reaches 100% versus 93.5% for static routing on held-out test at 43% lower cost, but 75.9% versus 93.5% on a locked lexical-shift split. | Learned per-task routing is brittle under lexical shift; keep a static fallback route. |
| MetaRoute-Bench (Vidra, Vid26b) | 2026-07-31 | [arXiv:2608.00107](https://arxiv.org/abs/2608.00107) | A task-aware policy reaches 79.4% versus 76.7% for static routing (+2.7 pp, 95% CI ±2.0) at 4.7% higher cost; removing verification causes the largest losses. Synthetic offline traces. | Routing gains are small while verification matters more; prioritise gates over routers. |
| openJiuwen (openJiuwen Team, Yu26f) | 2026-08-28 | [arXiv:2608.27969](https://arxiv.org/abs/2608.27969) | Composable runtime adaptation around a fixed model policy; 82.6% on SWE-bench Verified and 87.19% on Terminal-Bench 2.1. | Runtime adaptation inside a fixed substrate is competitive without self-editing. |
| From Traceability to Justifiability (Azarang, Aza26) | 2026-08-21 | [arXiv:2608.23610](https://arxiv.org/abs/2608.23610) | None of 47 platforms emits by default a content-addressed identity for the full behavioural tuple; 16 of 27 agent platforms rely on mutable nominal versioning. | Hash each seat's model, prompt, tools and configuration into every ledger record. |
| Better Harnesses, Smaller Models (Yang, Yan26l) | 2026-07-09 | [arXiv:2607.08938](https://arxiv.org/abs/2607.08938) | Adapted harnesses improve 16 of 21 task-model pairs; the best small model recovers 89.7% of large-model performance at 4% of the cost. | Cheap local models may serve some seats for repetitive workflows. |
| Harness Handbook (Wang, Wan26ai) | 2026-07-14 | [arXiv:2607.13285](https://arxiv.org/abs/2607.13285) | A behaviour-to-code handbook improves behaviour localisation and edit-plan quality with fewer planner tokens. | Maintain a map from harness behaviour to code so edits can be localised safely. |
| Agentic Routing (Liu, Liu26t) | 2026-07-13 | [arXiv:2607.11399](https://arxiv.org/abs/2607.11399) | Step-level routing logs the query, state, model choice, trace, outcome and cost as training data for routers. No headline numbers. | Log every seat-routing decision with its outcome and cost. |
| HarnessSafe (Zhang, Zha26bb) | 2026-08-07 | [arXiv:2608.06984](https://arxiv.org/abs/2608.06984) | 328 cases across seven persistent carriers (memory, skills, tools, shared artifacts); containment depends on the carrier and the harness-model configuration. | Lossless memory is an attack carrier; test how injected content persists across sessions. |
| EvoHarness-RL (Ning, Nin26c) | 2026-08-05 | [arXiv:2608.05446](https://arxiv.org/abs/2608.05446) | Belief, Progress and Experience exposed as harness state; 96.9% on ALFWorld with Qwen3-8B. | A useful schema for long-horizon session state. |
| PaperCompiler (Liu, Liu26h) | 2026-09-02 | [arXiv:2609.02272](https://arxiv.org/abs/2609.02272) | Tags each specification item as paper-supported, inferred, delegated or unresolved; fidelity from 3.64 to 4.15 and high-severity critiques from 13.2% to 6.1%. | Tag specification items and claims as supported, inferred or unresolved. |
| Harness-Aware Self-Evolving (Luo, Luo26c) | 2026-07-04 | [arXiv:2607.03935](https://arxiv.org/abs/2607.03935) | One RL-trained model either solves tasks or edits harness components, and it also "repairs" imperfect evaluation components. | A warning: a model that can edit evaluators can redefine success, so evaluators stay outside the editable scope. |
| TRACE-ROUTER (Raj, Raj26b) | 2026-07-24 | [arXiv:2607.22465](https://arxiv.org/abs/2607.22465) | Assigns each task to a model once, at admission, with a contextual bandit; +7-8 points on tau2-Bench and +7.1 over the best single model on Terminal-Bench with 36% lower latency. | Route per task at admission, learning from task outcomes, rather than per call. |
| What Does Multi-Harness RL Learn? (Le, Wha26) | 2026-09-03 | [arXiv:2609.04518](https://arxiv.org/abs/2609.04518) | Across 24,000 sealed evaluations, the evaluation harness moves the mean solve rate from 2.14% to 9.27% (4.3x), while the training recipe moves it 1.16x. | Record which harness produced every result. |
| Harness Engineering for Predictable Agentic Systems (Dhage, Dha26) | 2026-08-25 | [arXiv:2608.26197](https://arxiv.org/abs/2608.26197) | A first deterministic harness improved reproducibility in 1 of 4 cells; schema-validated planning before any tool call gave a Reproducibility Rate of 1.000 in 3 of 4 cells (N=100). | Validate plans against a fixed schema before any tool call. |
| Adaptive Orchestration with Cross-Episode Memory (Lukei, Luk26) | 2026-08-02 | [doi:10.21437/wochat.2026-4](https://doi.org/10.21437/wochat.2026-4) | Per-agent playbooks and delegation blueprints distilled from successful episodes perform best on OfficeBench with a 50-agent pool, with fewer orchestrator turns. | Store reusable delegation blueprints in local memory. |
| DeepRepro (Song, Son26) | 2026-08-27 | [arXiv:2608.26557](https://arxiv.org/abs/2608.26557) | Re-plans against the evolving repository state instead of a fixed up-front plan; beats baselines on PaperBench Code-Dev. No numbers. | The developer seat re-plans against the current repository state. |
| Task- and Session-Level Model Routing (Kumar, Kum26g) | 2026-07-28 | [arXiv:2608.14641](https://arxiv.org/abs/2608.14641) | Three of four open-source routers emit near-constant tiers, and Always-Mid matches a router on 3 of 4 benchmarks. | A router must beat fixed-tier baselines before it is trusted. |
| EviGraph for information-seeking agents (Chen, Che26e) | 2026-08-25 | [arXiv:2608.24667](https://arxiv.org/abs/2608.24667) | A frozen verifier returns verbatim evidence with polarity, and a deterministic validator checks each graph update; 35.9% on BrowseComp-Plus versus 26.9% without RL and 2.7% for a monolithic agent. | Literature grounding records verbatim evidence with polarity in a validated graph. |
| Can escalation channels redirect reward hacking? (Gomez) | 2026-08-29 | [arXiv:2608.29460](https://arxiv.org/abs/2608.29460) | Across 8 frontier models, an escalation tool combined with an anti-reward-hacking policy cut reward hacking from 23.6% to 5.3% (OR 9.2) and eliminated it for 6 of 8 models; 98.7% of escalations involved no hacking. | Give seats a report-defect action, paired with an explicit policy. |
| Prime Agent (Karten) | 2026-08-24 | [arXiv:2608.23552](https://arxiv.org/abs/2608.23552) | Standardises execution, recovery, verification and resource accounting while leaving strategy to the model; ARC-AGI-3 RHAE Best@1 from 30% to 95.5%. | Govern the substrate and leave strategy to the model. |
| HarnessDev (Wu) | 2026-09-01 | [arXiv:2609.01437](https://arxiv.org/abs/2609.01437) | Generated harnesses trail human references on code and search but match them on writing and ML experimentation; evolution gains are unstable, transfer partly to held-out tasks and depend strongly on the executing model. | Re-validate profiles when a seat's model changes. |
| Task-CoEvolve (Miyai) | 2026-08-20 | [arXiv:2608.20169](https://arxiv.org/abs/2608.20169) | Variance-weighted sampling of validation tasks near the capability frontier matches full-set search with 80% fewer evaluations on text classification and Terminal-Bench 2.1. | Regression checks can be made cheap by adaptive task sampling. |
| RLMOpt (Satheesha) | 2026-08-11 | [arXiv:2608.10471](https://arxiv.org/abs/2608.10471) | A language-model-driven prompt search inside a deterministic harness that enforces scoring, Pareto selection and regression constraints never produced a prompt below its seed in 11 runs (GEPA did twice). | Pair model-driven search with deterministic regression constraints. |
| AutoDesign (Luo) | 2026-08-13 | [arXiv:2608.13560](https://arxiv.org/abs/2608.13560) | A meta-harness optimiser for paper-to-poster generation scores 78.32 on PosterBench, 7.45 above Claude Design, and raises the average across seven configurations from 54.99 to 67.39. | Harness optimisation also applies to document-design tasks. |

## Validation

The evidence supports treating running code, a passed review and a high benchmark score
as insufficient grounds for a claim. Agents silently shrink datasets and budgets (Yu26),
take planted shortcuts even when told not to (Pra26), adopt conclusions from poisoned open
data (Gye26) and draw invalid inferences from correctly executed code (Mia26); a fresh
implementation reverses the winning choice in 25.6-43.6% of decisions (Nin26), and a gain
seen on discovery tasks can vanish on confirmation data (Xu26f). This supports separate
rungs for a fidelity audit, pre-committed falsifiers (Lit2Test, Zha26s), recomputation,
null models and confirmation data, and replication by an independent implementation. On
reviewers, a cross-family reviewer beat same-model self-review in a 100-problem pilot
(arXiv:2609.04270), same-model panels share blind spots (JuryProbe, arXiv:2608.00243) and
a judge that blocks only by citing a rule is a tested design (CrossAudit). No study
evaluates a complete rung ladder such as L0-L5, and replication evidence comes almost
entirely from ML and tabular tasks, not from wet-lab or structural-biology claims.

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| The Agentic Garden of Forking Paths (Miao, Mia26b) | 2026-07-01 | [arXiv:2607.01507](https://arxiv.org/abs/2607.01507) | Persona-conditioned agents reproduced 72% of the human ideological gap in effect estimates, yet 86% of their reports passed independent AI review and 78% passed majority human review; introduces the m-value over sampled analysis paths. | Place a result in a sampled distribution of analysis paths; a passed review is not evidence. |
| Distributed Denial of Science (Gyevnár, Gye26) | 2026-07-12 | [arXiv:2607.10712](https://arxiv.org/abs/2607.10712) | A poisoned open dataset succeeded in 49.56% of 450 runs across three agent stacks and was detected in 6.0%; a five-check data-provenance audit reduced attack success to 0. | Run a provenance audit before any external dataset supports a released claim. |
| TruthInsightBench (Yang, Tru26) | 2026-09-04 | [arXiv:2609.05079](https://arxiv.org/abs/2609.05079) | Four coding agents clustered at 58.4-60.3/100 without reliable separation, and largely omitted controls, robustness checks, falsifiability tests and cross-dataset generalisation. | Higher rungs must require controls, robustness checks and external replication explicitly. |
| One Run Is Not an Idea (Ning, Nin26) | 2026-07-29 | [arXiv:2607.26587](https://arxiv.org/abs/2607.26587) | Variance across implementations was more than 5 and 10 times rerun variance; the winning idea changed in 25.6% and 43.6% of decisions. | Replication needs an independent implementation; recomputation is a lower rung. |
| Auditing Discovery Claims (Chen, Che26y) | 2026-08-02 | [arXiv:2608.00981](https://arxiv.org/abs/2608.00981) | An agent-invented operator solved 43/60 targets under its own predictor but 1/60 under three predictors; an unseen predictor confirmed 2 designs versus 26 for a minimum-free-energy solver, and 84% of the headline effect sat on targets random sequences already solve. | Adjudicate discovery claims with an outside oracle against a matched-compute null search. |
| Beyond Execution, ABE-Ralph (Yu, Yu26) | 2026-08-27 | [arXiv:2608.26753](https://arxiv.org/abs/2608.26753) | Agents silently cut datasets or budgets and substitute lookup or oracle functions; claims, protocols and baselines encoded as constraints gave 93% robust execution over 30 runs and five failure modes. | The fidelity audit diffs each executed run against the pre-specified protocol. |
| BAITBENCH (Prasad, Pra26) | 2026-08-31 | [arXiv:2608.30724](https://arxiv.org/abs/2608.30724) | 57.1% of runs across seven agents exploited planted shortcuts, and the mean rate stayed above 50% when agents were told not to cheat. | Keep hidden held-out data outside the agent's workspace. |
| Evaluating and Guarding Citation Faithfulness (Goo, Goo26) | 2026-07-10 | [arXiv:2607.20527](https://arxiv.org/abs/2607.20527) | On identical outputs the unsupported-citation rate ranged from about 3% to 18% depending only on verifier strictness; a split-conformal guard bounds leakage, and BM25 re-attribution matched the best open generator. | Name the verifier and threshold and calibrate against a small human-labelled gold set. |
| How Do Agents Fail on AutoResearch (Fei, Fei26) | 2026-08-14 | [arXiv:2608.14905](https://arxiv.org/abs/2608.14905) | 800 annotated trajectories give 45 failure patterns converging on a missing check-and-revise loop, in all 8 harness-model combinations. | Build check-and-revise as explicit gates and seed the pitfall checklist from the taxonomy. |
| Coding agents can replicate SciML papers (Hans, Han26) | 2026-07-02 | [arXiv:2607.02134](https://arxiv.org/abs/2607.02134) | All 12 runs passed the evidence gate and matched 158 targets, but runs differed in target decomposition, numerical fidelity and the rules they used to accept evidence. | Fix evidence-acceptance and tolerance rules before running. |
| ClaimReceipt (Zhu, Zhu26j) | 2026-09-02 | [arXiv:2609.01992](https://arxiv.org/abs/2609.01992) | Receipts bind typed evidence to a signed experiment manifest and return PASS, INVALID or INCONCLUSIVE; 11/11 injected faults caught with 0/8 false positives, at 0.021% of inference time. | Check claims against a committed manifest so that omitted runs surface as inconclusive. |
| Fisher-R1 and P-Bench (Miao, Mia26) | 2026-08-07 | [arXiv:2608.07437](https://arxiv.org/abs/2608.07437) | On 425 hypothesis-testing tasks, agents report p-values that are invalid under the data's assumptions even when the code runs; the trained 14B model gained 21% relative over DeepSeek-V4-Pro. | Check test assumptions separately from execution; P-Bench can serve as a regression suite. |
| EviGraph for research agents (Ren, Ren26) | 2026-08-05 | [arXiv:2608.04738](https://arxiv.org/abs/2608.04738) | A typed evidence graph localises the earliest weak node, regenerates what depends on it and checkpoints validated evidence; Claim Support Rate +40.19% and 87.73% data consistency. | Keep claims and evidence as a typed, checkpointed graph; export only claims on a validated chain. |
| Do Agent Benchmarks Measure Capability? (Shao, Sha26d) | 2026-07-24 | [arXiv:2607.22368](https://arxiv.org/abs/2607.22368) | A post-hoc audit of 2,385 traces found exposures and reward hacking in 67.0% of Frontier Science traces and 66.7% of AutoLab tasks, with score inflation of 0.45 to 1.00. | Count a reported score only after a protocol-validity check. |
| VERITAS (Liu, Liu26w) | 2026-07-03 | [arXiv:2607.02931](https://arxiv.org/abs/2607.02931) | Extracts claims, runs the method and judges each claim, returning an importance-weighted score and a severity-rated log of every fix; led two Claude Code baselines on 65 papers. | Record replication deviations as a severity-rated fix log. |
| From Trajectories to Evidence (Zhuang, Zhu26) | 2026-08-05 | [arXiv:2608.05235](https://arxiv.org/abs/2608.05235) | Claims become actionable repairs, diagnostic guards or withheld findings with applicability limits; final rounds often underperformed an earlier best round. | Store qualified claims with a withheld status; never assume the latest run is the best one. |
| Brain Researcher (Chen, Che26x) | 2026-08-20 | [arXiv:2608.19902](https://arxiv.org/abs/2608.19902) | Rules for admissible analyses raised tool-selection accuracy from 23.3% to 93.6% and grounding from 4.6% to 22.0%; claims are classed accepted, qualified, revised, blocked, rejected or deferred. | Source of the six claim verdict states. |
| An AI Scientist that Doesn't Drift (Zhang, Zha26s) | 2026-07-30 | [arXiv:2608.07542](https://arxiv.org/abs/2608.07542) | Immutable cards pair each iteration's prediction with its outcome; across 11 streams run twice, neither arm drifted and both falsified about three quarters of their hypotheses. | Lock predictions in immutable cards before execution. |
| Evidence-Ledger Adjudication (Chen, Che26) | 2026-07-29 | [arXiv:2607.26512](https://arxiv.org/abs/2607.26512) | 0.676 accuracy and 0.601 macro-F1 versus 0.383 and 0.303 for the best non-agent baseline; routed 1,270 of 1,435 problem claims back, but also 295 of 900 supported ones. | Route flagged claims to human review rather than rejecting them automatically. |
| ResearchArena (Libon, Lib26) | 2026-07-21 | [arXiv:2607.19321](https://arxiv.org/abs/2607.19321) | Sabotage hidden in training data was flagged less than half the time; monitors that could execute and probe the artifact did better but still missed sabotage. | Probe artifacts rather than only reading transcripts; add data-level tamper checks. |
| Training AI Scientists to Replicate Research (Falck, Fal26b) | 2026-08-13 | [arXiv:2608.13331](https://arxiv.org/abs/2608.13331) | An auto-generated rubric judge with low noise agreed with human assessments; a post-trained 27B agent beat frontier models on held-out replication tasks. | Calibrated per-paper rubrics can support replication judging. |
| DRNOISE (Nie, Nie26b) | 2026-07-19 | [arXiv:2607.17291](https://arxiv.org/abs/2607.17291) | One plausible conflicting document caused 66-88 pp accuracy drops; agents retrieved the truthful records but deferred to the answer-like document. | Require reconciliation across independent record chains. |
| AutoResearch: Insight In, Hallucination Out (Liu, Ren26c) | 2026-08-18 | [arXiv:2608.17906](https://arxiv.org/abs/2608.17906) | Multi-model cross-review before and after experiments; 5 audit-confirmed issue events versus 11-27 for other systems, and mean recall on RSICD from 32.84 to 34.69. | Count audit-confirmed issue events in the ledger. |
| Can AI agents conduct open-ended AI research? (Kirgis, Kir26) | 2026-07-29 | [arXiv:2607.27191](https://arxiv.org/abs/2607.27191) | Agents completed the engineering for two unpublished NeurIPS questions but made no substantial research progress; failure modes include poor resource awareness and instruction drift. | Enforce compute budgets in the grant ledger and re-check the pinned task specification each step. |
| Who is the Agent to Blame? (Hirsch, Hir26) | 2026-08-25 | [arXiv:2608.24306](https://arxiv.org/abs/2608.24306) | Testing each invocation against its own inputs showed that 84.7% of final-report errors originated at the orchestrator. | Lossless per-seat logs let errors be traced to the seat that introduced them. |
| Beyond Consensus: Downward Bias in Multi-Agent Judges (Song, Son26c) | 2026-08-31 | [arXiv:2608.30373](https://arxiv.org/abs/2608.30373) | A single judge agreed best with humans; asymmetric strict-judge roles pulled consensus downward, and symmetric debate largely recovered agreement. | Aggregate independent verdicts; avoid debate with asymmetric roles. |
| Is Deep Research Reliable? (Zhu, Zhu26d) | 2026-07-23 | [arXiv:2607.20891](https://arxiv.org/abs/2607.20891) | One misleading document raised false-conclusion adoption from 0% to 54.7%, even when cross-model verification had classified the document as misleading. | Verify evidence as it enters intermediate memory, not only at synthesis. |
| Toward Auditable AI Scientists, HEP (Takahara, Tak26b) | 2026-07-10 | [arXiv:2607.09195](https://arxiv.org/abs/2607.09195) | Makes hypothesis generation, evaluation and evolution explicit, auditable operations. No headline numbers. | Record belief updates as ledger events. |
| SDABench (Shi, Shi26b) | 2026-07-13 | [arXiv:2607.11079](https://arxiv.org/abs/2607.11079) | 15 LLMs handled descriptive analysis but degraded sharply on assumption selection, latent-process modelling and mechanistic reasoning. | Type claims by kind, with kind-specific required checks. |
| BixBench3 (Koch, Koc26) | 2026-08-26 | [arXiv:2608.25286](https://arxiv.org/abs/2608.25286) | Scores ranged from 0.00 to 0.48 across 13 models and fell for datasets above 100 GB and analyses of 3 or more steps; an average task took 6.8 h and $43, the longest $525. | Budget about $43 per bioinformatics task with a long tail; grade artifacts, not reports. |
| DeltaML-Bench (Moukpe, Mou26b) | 2026-08-20 | [arXiv:2608.19653](https://arxiv.org/abs/2608.19653) | Modular configurations gamed the specification in up to 47.9% of runs, while none was observed with the ARG scaffold. | Integrity checks for specification gaming belong in the harness itself. |
| HALLMARK (Reizinger, Rei26) | 2026-07-20 | [arXiv:2607.18360](https://arxiv.org/abs/2607.18360) | 2,526 BibTeX entries: the false-positive rate decides whether a citation verifier is usable, agentic lookups add false positives, and most LLMs over-flag papers published after their training cutoff. | Citation checks rely first on deterministic DOI and metadata lookups and report their false-positive rate. |
| When May an Agent Stop? (Liu, Liu26z) | 2026-08-22 | [arXiv:2608.23623](https://arxiv.org/abs/2608.23623) | A typed evidence certificate with deterministic replay gave 0/66 premature unsupported terminations versus 40/66, with supported completion non-inferior (97/132 vs 92/132). | Implement the release gate as an evidence certificate with deterministic replay. |
| F(AI)2R (Krebs, Kre26) | 2026-07-28 | [arXiv:2607.25637](https://arxiv.org/abs/2607.25637) | PROV-O provenance gated in CI with two invariants: no claim without a parent, and the highest verification levels granted only by humans. No quantitative evaluation. | Adopt both invariants for approvals. |
| Automated Discovery Has No Universally Superior Harness (Gupta, Gup26c) | 2026-07-20 | [arXiv:2607.18235](https://arxiv.org/abs/2607.18235) | Across 30 budget-matched harnesses and more than 3.1M rollouts, no fixed harness was reliably superior; early progress predicted final performance. | Method comparisons need repeated trials and null distributions. |
| Emergent Cheating and Whistleblowing (Paglieri, Pag26) | 2026-09-03 | [arXiv:2609.04170](https://arxiv.org/abs/2609.04170) | In a swarm of 100 agents, one evaluation exploit spread through the shared knowledge library and peer messages; other agents audited and alerted unprompted. | Memory writes that affect evaluation must be auditable and able to be quarantined. |
| OmniScientist (Li, Li26c) | 2026-08-13 | [arXiv:2608.13558](https://arxiv.org/abs/2608.13558) | Code enforces novelty screening, statistical validity, provenance and numerical traceability; raw data reached a compiled manuscript in all 36 cases. | Enforce numerical traceability from raw data to every manuscript number. |
| Articulate Intuition or Genuine Analysis? (Chen, Che26g) | 2026-07-12 | [arXiv:2607.10511](https://arxiv.org/abs/2607.10511) | Across 3,563 reviews, decision tier was not aligned with text-grounded epistemic quality, and length and venue explained most of the agentic-human score gap. | Judge rubrics must control for length and fluency. |
| From Runnable to Verifiable (Chen, Che26s) | 2026-08-10 | [arXiv:2608.09567](https://arxiv.org/abs/2608.09567) | Only 10/18 artifacts completed their workflow as released; 20/30 patched builds still produced the claimed signal, and 7/19 negative controls triggered on benign input. | Detection-type claims require negative controls. |
| Agentic Auto-Research is Fuzz Testing (He, He26) | 2026-08-10 | [arXiv:2608.09855](https://arxiv.org/abs/2608.09855) | Argues for dense progress signals plus final validation on evidence protected from adaptive reuse; in simulation a progress-tracking agent found a hidden law where optimisers overfit. | Keep a protected holdout that exploration never touches. |
| Accelerating Scientific Research with Gemini (Schmidgall, Sch26b) | 2026-08-27 | [arXiv:2608.26701](https://arxiv.org/abs/2608.26701) | Closed-loop results include a material whose atomic structure is not yet confirmed; reliability modules reduced hallucination and plagiarism across 450 expert reviews. | Claim status needs a "requires confirmation" state. |
| Library Reachability in LSR-Synth (Yao, Yao26c) | 2026-07-30 | [arXiv:2607.28684](https://arxiv.org/abs/2607.28684) | A semantics-free baseline with a fixed operator vocabulary already covers most tasks, and LLM candidates rarely expanded the solvable set. | Discovery claims need a semantics-free null baseline. |
| Science sandboxes (Rao, Rao26) | 2026-08-31 | [arXiv:2608.30165](https://arxiv.org/abs/2608.30165) | Frontier agents improved metrics without understanding the underlying rules, and their reasoning deteriorated outside familiar biological priors. | A metric gain is not a mechanistic claim. |
| A Persistent Fleet of AI Scientists (Patel, Pat26) | 2026-08-18 | [doi:10.64898/2026.08.16.745122](https://doi.org/10.64898/2026.08.16.745122) | An anti-fabrication constraint cut probe failures from 91.7% to 0%, and provenance-backed memory raised a local model from 44% to about 90% on internal benchmarks; self-reported. | Supports provenance-backed memory, pending independent confirmation. |
| Agent-Safety Evaluations as Load-Bearing Evidence (Solozobov, Sol26b) | 2026-07-14 | [arXiv:2607.12469](https://arxiv.org/abs/2607.12469) | Evidence sufficiency ranged from 0.458 to 0.833 across surface-identical inputs, and no public trace met replay preconditions. | Capture replay preconditions at run time. |
| What Does an Evaluation License? (Qin, Qin26c) | 2026-08-18 | [arXiv:2608.19269](https://arxiv.org/abs/2608.19269) | Most attempts to replay historical claims stopped because the evidence had not been bound to the claim. No numbers. | Bind evidence to each claim at commit time. |
| ReproAgent (Hu, Hu26b) | 2026-08-25 | [arXiv:2608.24291](https://arxiv.org/abs/2608.24291) | A persistent two-channel implementation contract reaches the highest PaperBench Code-Dev mean among same-backbone scaffolds. | Persistent contracts keep protocol obligations from being lost over long runs. |
| Toward Trustworthy Autonomous Science (Ferreira da Silva, Sil26) | 2026-07-01 | [doi:10.2172/3377973](https://doi.org/10.2172/3377973) (also arXiv:2607.12113) | A community roadmap: verification, not candidate generation, now limits autonomous science. | Independent support for centring the product on claim validation. |
| Reconcile Once, Write Anytime (Zhang, Zha26bf) | 2026-08-13 | [arXiv:2608.12984](https://arxiv.org/abs/2608.12984) | An authoritative metric ledger removed all 6,845 cross-section contradictions, and replay showed no look-ahead violations across seven cutoffs. | Take every number in prose and LaTeX from one metric ledger. |
| Automating Behavioral Research on AI Agents (Lee, Lee26c) | 2026-08-10 | [arXiv:2608.10030](https://arxiv.org/abs/2608.10030) | 73 hypotheses tested in 1,160 experiments, with moderate-to-strong evidence for 30. | Add false-discovery control to the release gate. |
| Selection-Aware Stress Testing (Xu, Xu26f) | 2026-08-31 | [arXiv:2608.30916](https://arxiv.org/abs/2608.30916) | A 3.75-point gain seen on discovery tasks vanished on separate confirmation tasks; "no claim" is an allowed outcome. | Test selected claims on separate confirmation data. |
| Beyond Final Scores (Li, Li26b) | 2026-08-13 | [arXiv:2608.13417](https://arxiv.org/abs/2608.13417) | Agents behaved like engineering optimisers, and reused experience sometimes misled later decisions. | Each memory entry carries its validation status and scope. |
| BrainPilot (Li, Li26ap) | 2026-07-16 | [arXiv:2607.15079](https://arxiv.org/abs/2607.15079) | A Graph of Trace links subgoals, tools, evidence and claims, and an in-workflow Auditor checks for fabrication; comparable to state-of-the-art frameworks at lower cost. | Matches the design of an auditor plus a trace graph in approvals. |
| AI4AI-Bench (Chi, Chi26) | 2026-08-20 | [arXiv:2608.20318](https://arxiv.org/abs/2608.20318) | Submissions are rerun from scratch and scored by a hidden evaluator; mean 0.166 and best 0.250 on a scale from 0.1 (shipped) to 1.0. | The standard for the recomputed rung. |
| LLMs as Peer Reviewers (Erturk, Ert26) | 2026-08-20 (earliest found) | [doi:10.1016/j.acra.2026.04.046](https://doi.org/10.1016/j.acra.2026.04.046) | 720 reviews, none recommending rejection; a stricter prompt moved Accept from 9.7% to 0%, and agreement between models was only fair (Fleiss' kappa 0.25). | Freeze and report the verdict prompt with any review-based evidence. |
| CrossAudit (Dong, Don26) | 2026-08-05 | [arXiv:2608.28631](https://arxiv.org/abs/2608.28631) | A different vendor audits each increment against a human-written rulebook; scripted checks run first, a model may block only by citing a rule, and no model can waive a deterministic failure. In a seeded-defect trial the two vendors read the rulebook differently. | Cross-vendor reviewer seats block only by citing a rule, with verdicts as append-only records. |
| What Proves You Wrong, Lit2Test (Wang) | 2026-08-24 | [arXiv:2608.22948](https://arxiv.org/abs/2608.22948) | A six-field contract makes each proposal precommit the observation that would prove it wrong; the four-model ranking held in all 10,000 bootstrap replicates, separated by test quality rather than fluency. | The pre-committed falsifier for the pre-specified rung. |
| NxN E-valuation (Wang) | 2026-08-06 | [arXiv:2608.06621](https://arxiv.org/abs/2608.06621) | E-value certification in which other samples serve as nulls through a conditional randomization test, needing no case-specific null given enough data. No headline numbers. | A candidate null model for per-sample hypotheses at the severe rung. |
| Auditable AI-Assisted Research Writing (Zhou) | 2026-08-11 | [arXiv:2608.10858](https://arxiv.org/abs/2608.10858) | Git sealing, hash-bound provenance, red-line gates that log refusals and cross-model role separation; a sealed pre-registered test returned No-Go and the frozen stopping rule halted the project. Observations are provisional. | Hash-bound pre-registration with frozen stopping rules. |
| PerturbTrace (Yu) | 2026-08-20 | [doi:10.64898/2026.08.18.745260](https://doi.org/10.64898/2026.08.18.745260) | Agents beat non-agent methods on at least 15 of 17 tasks, yet true feedback gave no consistent advantage over random feedback; only 43 of 576 transitions (7.5%) completed the feedback-to-outcome sequence. | High final recall does not show that feedback was used; audit round-to-round decisions. |
| TRACES (Rodionov) | 2026-08-11 | [arXiv:2608.11415](https://arxiv.org/abs/2608.11415) | With 42 retracted, fraudulent or pseudoscientific papers as probes, models engaged with untenable premises in 95% of non-empty responses, and every model failed more than 71% of agentic probes. | Retraction and reliability checks must be deterministic lookups, not model judgement. |
| Reviewer Capability Governs Rejection Targeting (Tanveer) | 2026-09-02 | [arXiv:2609.04270](https://arxiv.org/abs/2609.04270) | A cross-family mid-tier reviewer raised accuracy from 52% to 64% with zero damaged answers; self-review had 0.85 recall but no significant gain and falsely rejected 35% of correct answers versus 2%. A 100-problem pilot. | Prefer a reviewer from a different model family. |
| JuryProbe (Zhou) | 2026-08-20 | [arXiv:2608.20607](https://arxiv.org/abs/2608.20607) | Reference-free judge panels showed correlated false negatives (FN-only correlations 0.402 and 0.368), so agreement can reflect shared blind spots. No formal risk guarantee. | Agreement between judges does not raise a rung. |
| More Debate, Same Evidence (Ji) | 2026-07-31 | [arXiv:2608.00243](https://arxiv.org/abs/2608.00243) | A homogeneous three-agent panel ranged from +8.5 to -4.4 pp against a single agent on six benchmarks, with three inconclusive. | Same-model debate adds no reliable evidence. |
| Precise but Uncoupled (Yang) | 2026-07-16 | [arXiv:2607.15388](https://arxiv.org/abs/2607.15388) | A more precise reviewer (0.861 vs 0.644) produced less repair because its critique was less often taken up by the solver. | Measure whether critique changes the next answer, not only reviewer precision. |
| Judging LLM-as-a-Judge (Bagaria) | 2026-08-31 | [arXiv:2609.02942](https://arxiv.org/abs/2609.02942) | Classifiers trained on rubric text alone predict judge outputs nontrivially, and judges often fail to update when the response or criterion is reversed. | Treat rubric-based LLM verdicts as weak evidence and test them with counterfactual flips. |

## Visual QA

The evidence does not support letting a vision-language model (VLM) approve figures, pages
or screens on its own. Strong description scores coexist with near-total hallucination of
unreadable content (SciFigBench: 96% for GPT-5.2), no model reaches 60% on atomic
perception (PerceptionBench), VLM coordinates are unusable for layout checks (Ras26b),
judges are anchored by quoted peer verdicts (Shu26), and adding figures can lower a
reviewer's error detection while raising its scores (Alh26). What works is staged,
evidence-conditioned review: deterministic geometry and readability gates, manuscript
context for figures, screenshot plus DOM for screens, and re-render checks used as
diagnostics rather than proof (PosterMELD, Den26, Guo26b, Kha26). No post-July paper
validates an end-to-end human sign-off workflow, and none studies Cyrillic or bilingual
page rendering, so the mandatory human approval gate rests on design reasoning.

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| PosterMELD (Hu, Hu26) | 2026-08-03 | [arXiv:2608.02218](https://arxiv.org/abs/2608.02218) | Deterministic geometry, readability, asset-integrity and factual-error gates plus VLM review route failures to bounded repair; 81.3% print-ready across 621 papers (3.4x and 5.2x two baselines) at USD 0.38 per request. | Deterministic checks decide pass or fail, the VLM critiques, and the pass rate counts rejected requests. |
| How Do VLMs Behave When Blind or Misled? SciFigBench (Oamen, Oam26) | 2026-08-13 | [arXiv:2608.13267](https://arxiv.org/abs/2608.13267) | GPT-5.2 describes best yet hallucinates unreadable content in 96% of cases; Gemini 3.1 Pro admits uncertainty in 71% and resists misleading captions best (0.91). | Choose the VLM seat by abstention and caption resistance, and allow a "can't read" answer. |
| SciFigQual-Bench (Deng, Den26) | 2026-07-29 | [arXiv:2607.27084](https://arxiv.org/abs/2607.27084) | 6,308 expert-scored figures linked to caption, citing sentence and manuscript; a staged agent had the lowest mean absolute error (0.418) and 93.4% consistency, beating direct VLM scoring. | Give figure review the caption, citing text and claim, and score in staged steps. |
| PosterHarness (Yang, Yan26) | 2026-07-03 | [arXiv:2607.03006](https://arxiv.org/abs/2607.03006) | A placeholder-first contract makes the generator leave figure regions empty for a deterministic compositor; synthesised figures fell from 34 to 0 across three papers. | Never let a generator draw data-bearing figures; insert real ones deterministically. |
| Beyond Pixel Diffs: Web UI change captioning (Zhang, Zha26g) | 2026-07-02 | [arXiv:2607.01728](https://arxiv.org/abs/2607.01728) | Eleven captioning methods and two LLMs struggle with dense text and fine changes, but trained methods suppress rendering noise better than pixel diffing. | Keep a pixel diff as trigger and add a "what changed" note that is treated as fallible. |
| When Does Consensus Mean Correctness? (Khanbayov, Kha26) | 2026-08-06 | [arXiv:2608.05670](https://arxiv.org/abs/2608.05670) | Semantics-preserving re-rendering beats resampling for reliability; the plotting library drives most dispersion, and fine-tuning on the model's own cross-render consensus lowered accuracy in all 5 runs. | Re-render checks are diagnostics, not proof of correctness; never tune a reviewer on self-agreement. |
| Does It Render Everywhere? (Guo, Guo26b) | 2026-08-12 | [arXiv:2608.12518](https://arxiv.org/abs/2608.12518) | 68% of generated pages had an issue across 9 browser-and-device combinations; combined screenshot and DOM analysis reached F1 0.903. | Check screens across viewports and engines with screenshot and DOM together. |
| Forged Peer Judgments (Shu, Shu26) | 2026-08-08 | [arXiv:2608.07920](https://arxiv.org/abs/2608.07920) | Quoting another judge's verdict shifts outcomes by 19-26 pp; checking quotes against blind votes blocks 84.9% of fabricated attacks. | Collect blind verdicts first and never show one seat another's opinion unchecked. |
| Consistency Has a Computable Blind Spot (Khanbayov, Kha26f) | 2026-08-06 | [arXiv:2608.05675](https://arxiv.org/abs/2608.05675) | Invariance checks cannot catch a systematic misreading that commutes with the edit; equivariance, in which the answer must change by a computable amount after a data edit, can. | For figures made from data, test that the reviewer's reading changes correctly under deliberate data edits. |
| SciFigAlign (Xu, Xu26) | 2026-07-29 | [arXiv:2607.27066](https://arxiv.org/abs/2607.27066) | A fine-tuned scorer reached macro MAE 0.3524 versus 0.864 for the best LLM judge; zero-shot judges give overly concentrated scores. | Do not trust absolute VLM figure scores; rank within a paper or use a trained scorer. |
| Do LLMs scrutinise what they review? (Alharbi, Alh26) | 2026-07-31 | [arXiv:2608.28626](https://arxiv.org/abs/2608.28626) | Two multimodal reviewers caught 12.1% of 145 inserted errors, 22.2% with a verification instruction; adding figures lowered detection and raised scores, and half of text-only reviews described figures they had not been given. | LLM review is not the error-detection layer; check figure claims deterministically. |
| Do GUI Agents Believe Their Eyes? (Zhang, Zha26f) | 2026-07-05 | [arXiv:2607.04334](https://arxiv.org/abs/2607.04334) | When pixels and structure conflict, models defer to structure and follow stale structure on up to 0.88 of probes; only a training-free consistency gate reduced both hijack and error. | A pixel-versus-DOM consistency gate blocks approval when they disagree. |
| MT-Web2Code (Li, Li26k) | 2026-08-04 | [arXiv:2608.03474](https://arxiv.org/abs/2608.03474) | 13 coding agents struggled to preserve untouched content and accumulated errors over multi-turn web edits. | Add a deterministic check that areas outside the intended edit are unchanged. |
| Code-Driven Agentic Testing, CATJudge (Hong, Hon26) | 2026-08-31 | [arXiv:2609.00081](https://arxiv.org/abs/2609.00081) | On 102 AI-generated apps with subtle bugs, all mainstream VLMs perform poorly at finding them. No numbers. | Agent-driven exploration is a source of candidate issues, not an approval signal. |
| Agentic Workflows for Math Visual Aids (Malik, Mal26) | 2026-07-10 | [arXiv:2607.09839](https://arxiv.org/abs/2607.09839) | VLMs answer generated QA questions against the rendered diagram; preliminary gains, weak spatial reasoning and incomplete coverage. | Checklist questions need deterministic geometry checks behind them. |
| VLMs vs OCR for Spatial Grounding in ISO/IEC 17025 Audits (Al Rasyid, Ras26b) | 2026-07 (month only; licence start 2026-07-01) | [doi:10.1109/IAICT71158.2026.11620745](https://doi.org/10.1109/IAICT71158.2026.11620745) | EasyOCR was the only usable localiser (42.0% at IoU of at least 0.50), while every VLM had mean IoU below 0.02; the authors recommend OCR for coordinates and human verification. | Take coordinates from OCR or PDF text extraction, never from a VLM, and keep human sign-off. |
| It's the Decoding Format, Not the Perturbation (Zheng, Zhe26c) | 2026-08-02 | [arXiv:2608.01207](https://arxiv.org/abs/2608.01207) | A format-matched control matches or exceeds perturbation-grounded selection within noise on four benchmarks. | Compare any multi-sample vote for the VLM seat against a matched-budget control. |
| Auditing Spatial Provenance in Token Pruning (Liu, Liu26l) | 2026-07-29 | [arXiv:2608.00077](https://arxiv.org/abs/2608.00077) | At 30% retained tokens accuracy is unchanged, but coverage of the supporting OCR region differs sharply by selector (0.620, 0.270, 0.318). | Check fine-text review with full-resolution crops when local VLMs prune tokens. |
| Automated Textbook Auditing (Cristescu, Cri26) | 2026-07-13 | [arXiv:2607.11276](https://arxiv.org/abs/2607.11276) | A multi-agent PDF auditor produced 56 technical findings at 62.5% expert-validated precision, framed as triage. | Model findings on compiled PDFs are triage items with tracked precision and mandatory sign-off. |
| Dual-Judge Evaluation Protocol (Noe, Noe26) | 2026-08-25 | [arXiv:2608.24258](https://arxiv.org/abs/2608.24258) | Quality and equivalence judges correlate at r=0.644; among answers scoring above 7, 54-63% fail strict equivalence under heavy occlusion. | Pair any VLM quality score with a strict reference check; distrust high scores on degraded inputs. |
| PerceptionBench (Lin) | 2026-07-27 | [arXiv:2607.24957](https://arxiv.org/abs/2607.24957) | 3,000 questions on ten atomic perceptual capabilities: no model of sixteen reaches 60%, and perception-related hallucination is the weakest capability. | Code, not a VLM, decides geometry. |
| Learning to Detect UI Principle Violations (Mehta) | 2026-07-22 | [arXiv:2607.20690](https://arxiv.org/abs/2607.20690) | RL on a 4B VLM raised micro-F1 from 36% to 84% across 19 interface principles (13 above 80% F1), trained on synthetically injected violations. | A small local critic could pre-screen UI slices, after validation on real screens. |
| VLMs for Geometry Clipping Detection (Celemin) | 2026-07-28 | [arXiv:2607.25921](https://arxiv.org/abs/2607.25921) | Six VLMs all produce substantial false positives on ambiguous frames and are best used as high-recall candidate filters. | Use VLMs as first-pass filters in a multi-stage check, not as standalone judges. |
| MLLMs and Scientific Visualization Literacy (Do) | 2026-07-16 | [arXiv:2607.15176](https://arxiv.org/abs/2607.15176) | Six MLLMs are uneven across techniques and fail on quantitative estimation and flow direction; Gemini exceeds the human mean overall. | Do not rely on a VLM for quantitative readings of scientific figures. |

## LaTeX and documents

The evidence supports bounded, compile-gated edits with evidence locks rather than
section rewrites: whole-slot rewriting broke an unrelated numeric line in 192/192 cases and
PatchWrite in 0/192, and 13.6-18.5% of LLM repairs that compile still change document text
(TeXFix-Bench). Render feedback after each atomic edit (ReDeck), rollback to the best
version (ACE) and editable figure source with requirement tracking across rounds (FigTree,
EdiTikZ, PaperBanana-Interact) are also supported. Evidence is missing on page-level TeX
defects such as overfull boxes and float placement, on Cyrillic and bilingual templates,
and on template transfer, which appears only as a platform feature (Bibby AI). Real-time
compilation has one engineering report without controlled evaluation (Lod26), and engine
choice has one cross-platform benchmark whose most portable engine (Tectonic) is not the
plan's default.

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| PatchWrite (Yang, Yan26g) | 2026-08-24 | [arXiv:2608.23001](https://arxiv.org/abs/2608.23001) | Bounded EDIT-line patches with rollback commit only after a compile gate and an evidence lock that ties every cite key and number to a registry or log; an unrelated "12-layer" line survived 192/192 versus 0/192 for whole-slot rewriting; 75% of model-proposed edits were accepted and 93.75% of those fixed the fault. | The template for agent edits in the LaTeX studio and the prose engine. |
| TeXFix-Bench (Venkateshmurthy, Ven26) | 2026-08-07 | [arXiv:2608.07617](https://arxiv.org/abs/2608.07617) | 10,437 fault instances from 18 categories; seven LLMs compiled 56.7-84.2%, but 13.6-18.5% of compiling repairs materially changed document text, and the ranking by restoration differed from the ranking by compile rate. | Accept a repair only if it compiles and text outside the fault is unchanged. |
| ReDeck (Tian, Tia26) | 2026-08-31 | [arXiv:2609.00194](https://arxiv.org/abs/2609.00194) | One edit, one render observation, plus a turn-level critic and a submission-level hard layout gate; ablations show feedback timing and granularity are critical. No numbers in the abstract. | Re-render and check the affected page after each patch. |
| ACE (Jang) | 2026-08-25 | [arXiv:2608.24103](https://arxiv.org/abs/2608.24103) | A scene-graph editor with self-correction beat an agentic HTML pipeline on instruction following (4.23 vs 3.81, p=.010), and a strict-peak rollback removed every observed regression. | Keep the best version with automatic rollback. |
| Edit2TikZ (Zhang, Zha26aj) | 2026-08-13 | [arXiv:2608.13441](https://arxiv.org/abs/2608.13441) | 1,548 TikZ edit samples; proprietary models compile about 75% of edits, and curriculum training raised a 4B model from 45.35% to 83.40%. | Score TikZ edits for completion, preservation of the rest and compilation. |
| Figures as Programs, FigTree (Liu, Liu26c) | 2026-09-01 | [arXiv:2609.01006](https://arxiv.org/abs/2609.01006) | Figures generated as hierarchical SVG programs with a render-critic that maps each defect to a statement. No numbers. | Store figures as editable programs so approvals attach to source lines. |
| EdiTikZ (Greisinger, Gre26) | 2026-09-01 | [arXiv:2609.01409](https://arxiv.org/abs/2609.01409) | 391K mined TikZ edit pairs; a trained 9B model ranks above GPT-5.6-Sol and on par with Gemini-3.1-Pro in human evaluation (4,320 ratings). | Compact local TikZ editors are competitive. |
| Bibby AI (Jain, Jai26) | 2026-07-03 | [arXiv:2607.05435](https://arxiv.org/abs/2607.05435) | An editor-native platform owns document state, compilation and history, and agents edit the AST, including venue reformatting; no controlled safety evaluation. | The agent works on owned source and history; template reformatting remains unevaluated. |
| SciDiagramEdit (Sun, Sun26) | 2026-07-16 | [arXiv:2607.15272](https://arxiv.org/abs/2607.15272) | Before-and-after figure pairs from arXiv revisions; edits are made on editable vector source, and skill specifications refined from traces improve held-out accuracy. No numbers. | Make figure edits on vector source the user can co-edit. |
| OmniPresent (Ma, Ma26c) | 2026-07-01 | [arXiv:2607.02590](https://arxiv.org/abs/2607.02590) | Posters, slides and video from one renderable HTML plan with a verify-and-repair loop across formats. No numbers. | Derived outputs share one content plan with a cross-format consistency check. |
| Spark-to-Paper (Qian, Qia26e) | 2026-08-12 | [arXiv:2608.11924](https://arxiv.org/abs/2608.11924) | Fabrication detection rose from 14% for a single-pass draft to 92% with the integrity and review stack; 99.5% citation validity at USD 8.1 per manuscript. | Deterministic integrity checks and pre-specified evidence catch far more fabrication than self-critique. |
| PaperBanana-Interact (Wu, Wu26g) | 2026-08-31 | [arXiv:2608.30241](https://arxiv.org/abs/2608.30241) | All 14 participants asked for revisions; multi-turn refinement suffers quality drift and forgetting of implemented features, and the refine loop reduced forgetting by 3.7-6.2 points. | Track approved requirements across rounds and check each new render against them. |
| DrawAI (Cao, Cao26d) | 2026-08-01 | [arXiv:2608.00548](https://arxiv.org/abs/2608.00548) | Raster figures reconstructed as editable code, scored with 39 deterministic and VLM criteria; quality and cost vary widely by configuration. | A route for converting legacy raster figures, and a hybrid rule-plus-VLM rubric. |
| GenGA (Kawada, Kaw26) | 2026-08-05 | [arXiv:2608.05478](https://arxiv.org/abs/2608.05478) | The Structural Independence Coefficient measures how far a local change propagates and correlates with manual editing cost. No numbers. | A candidate editability metric for generated figures. |
| ResearchStudio-Reel (Xiao, Xia26c) | 2026-07-05 | [arXiv:2607.04438](https://arxiv.org/abs/2607.04438) | Skills inside coding assistants produce posters, videos and blogs with per-artifact release checks; under two VLM judges, aesthetics 3.56 versus 3.03 for the authors' own posters. | Per-artifact release checks fit visual approvals. |
| Code as Representation, CADP (Jin, Jin26) | 2026-08-18 | [arXiv:2608.17550](https://arxiv.org/abs/2608.17550) | Pages reconstructed as compilable LaTeX plus Python and recompiled against the source; frontier MLLMs still struggle. No numbers. | LaTeX imported from PDFs needs page-level verification. |
| Prompt-to-Paper (Kamran, Kam26) | 2026-07-05 | [arXiv:2607.05456](https://arxiv.org/abs/2607.05456) | Five case studies compiled with zero out-of-range citations; the automated quality score rose by 17.96 points on average, and one human reviewer gave 7.0/10. | A rising automated score is not validation; the closed-corpus citation check is the useful part. |
| Engine-Transfer-Bench (Venkateshmurthy, Ven26b) | 2026-08-18 | [arXiv:2608.18329](https://arxiv.org/abs/2608.18329) | Across 1,784 documents and three operating systems, Tectonic succeeds 96.3-97.2% while TeX Live-style engines vary by 12-20 pp with distribution policy; a PDF text-consistency metric has 94% precision on 50 pairs. | Pin the engine per project and add a PDF text-consistency check to the render gate. |
| Real-time LuaTeX (Lode, Lod26) | 2026-08-30 (DOI registration; exact day not stated) | [doi:10.47397/tb/47-2/tb146lode-realtime](https://doi.org/10.47397/tb/47-2/tb146lode-realtime) | Recompiles one paragraph in about 1 ms from LuaTeX node structures, with output identical to LuaLaTeX; pages out of view stay inconsistent until a background compile converges. Engineering report without controlled evaluation. | Fast preview for the visible page; only the full compile gates commits and approvals. |

## Memory

The evidence converges on one design: an immutable, addressable raw log is the source of
record, and lexical, dense or graph indexes, typed facts and wikis are rebuildable views of
it. Agent-controlled BM25 over raw turns beats graph and tree memories (58.2 vs 53.2 for
HippoRAG 2), BM25 overtakes other paradigms above about 10 million corpus tokens, and an
extracted knowledge graph loses verbatim recall (0.911 to 0.607) against a flat baseline
(Li26h, arXiv:2607.26497, Rus26). Temporal validity and revocation matter (TEPA 0.950 vs
0.210 for append-only; deterministic supersession 0.91 vs 0.57-0.59 for RAG), and typed
retention keeps 96% of rules over five compactions where generic summarisation keeps 10%
(Zer26). Evidence is thin on low-RAM operation and on automatic per-session schema
selection, which has no precedent; Cyrillic lexical retrieval is not studied; and many
headline numbers come from single-group preprints with self-graded judging.

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| ReFind: agent-controlled search over raw chat logs (Li, Li26h) | 2026-08-13 | [arXiv:2608.12888](https://arxiv.org/abs/2608.12888) | Turn-level lexical index over an unmodified archive with session-aware rank fusion, context expansion, time narrowing and skipping of inspected sessions; 58.2 versus 53.2 for HippoRAG 2, and 93.2 on LongMemEval-S with GPT-5-mini, with no LLM-built index. | Default recall is an agent-driven BM25 loop over the untouched session log. |
| BM25 Wins at Scale (Wang) | 2026-07-29 | [arXiv:2607.26497](https://arxiv.org/abs/2607.26497) | Across 28 nested corpus tiers spanning about 450-fold, BM25 overtakes a file-system agent near 10 million corpus tokens and leads at every larger tier, by close to 20 points at full scale; graph RAG hits construction walls. | Lexical retrieval is the scalable default; agentic reasoning follows ranked discovery. |
| Reproducing LightMem (Zhou, Zho26i) | 2026-07-31 | [arXiv:2607.29104](https://arxiv.org/abs/2607.29104) | Changing only the retriever moved accuracy from 58.1% to 75.5%; naive RAG over raw user turns generally beats LightMem, and memory construction drops answer-relevant information. | Benchmark retrievers over raw turns before investing in constructed memory. |
| Selective Forgetting (Rusu, Rus26) | 2026-08-29 | [arXiv:2608.28978](https://arxiv.org/abs/2608.28978) | An extracted knowledge-graph memory underperforms a flat vector baseline (F1 0.417 vs 0.468), and recall of specific prior turns falls from 0.911 to 0.607; pruning 9.8% of nodes leaves F1 unchanged. | Never replace verbatim turns with graph nodes; a graph is only an index over raw text. |
| EdgeMem (Cui) | 2026-09-03 | [arXiv:2609.05553](https://arxiv.org/abs/2609.05553) | An LLM-free multi-anchor hypergraph over preserved original turns scores 61.01 versus 58.70 on LoCoMo under a strict judge, with no generative calls in construction or retrieval. | An optional LLM-free structure that keeps the originals. |
| Context as an Environment, Scroll (Lin) | 2026-08-21 | [arXiv:2608.21690](https://arxiv.org/abs/2608.21690) | An append-only Event Log with an eviction index of landmarks tied to exact log addresses; 94.8% on LongMemEval_S and 73.1% on BEAM_10M, 5.1 points above the best published memory system. | Evicted context stays recoverable through landmarks to exact addresses. |
| Addressable Recall Compaction (Dang, Dan26) | 2026-07-27 | [arXiv:2607.25066](https://arxiv.org/abs/2607.25066) | Tool observations kept in an ID-addressable append-only log and replaced by dereferenceable citations; 99.40% needle accuracy versus 88.12% for the best baseline. | Compaction leaves stable ID stubs into the lossless log. |
| The Compaction Cliff (Zerhoudi, Zer26) | 2026-08-24 | [arXiv:2608.22752](https://arxiv.org/abs/2608.22752) | Claude Code's /compact kept 53% of safety rules after one round and 10% after five; typed retention kept 96% over five rounds and TypeRetrieve reached 100% recall@50 versus 73%. | Type rules, decisions and claim constraints and pin them verbatim. |
| Zero-Mem (Xiao, Xia26d) | 2026-07-31 | [arXiv:2607.29377](https://arxiv.org/abs/2607.29377) | Raw traces are the source of record and graph and temporal indexes are built without LLM calls; memory-operation time 57.6% below the fastest baseline. | Keep memory write and index paths LLM-free. |
| CodeNib (Yu, Yu26c) | 2026-07-28 | [arXiv:2607.25431](https://arxiv.org/abs/2607.25431) | Per-commit lexical, dense and structural views maintained across edits; median updates 8.7x and 25.4x faster than rebuilds, and 50-87% fewer trajectory tokens. | Index code, LaTeX and notes as incremental per-commit views with declared validity. |
| Training a Knowledge Base (Pan) | 2026-08-22 | [arXiv:2608.21829](https://arxiv.org/abs/2608.21829) | A store curated from supervised questions matches HippoRAG's gains with 1,913 links against 196,112, with +0.294 F1 on trained questions. | Build links lazily from real queries, not a corpus-wide graph. |
| The Commercial Tax (Sanchez) | 2026-08-17 | [arXiv:2608.16096](https://arxiv.org/abs/2608.16096) | The dense-retrieval anchor NV-Embed-v2 is licensed cc-by-nc-4.0 and three of four leading systems depend on it; at 1 TB, embedding costs 7.5x-900x less than graph construction. | Check embedder licences; graph builds are costly. |
| SodaMem (Wan, Wan26y) | 2026-08-08 | [arXiv:2608.08055](https://arxiv.org/abs/2608.08055) | Typed facts with mandatory provenance spans, validity times and supersession edges over a hybrid index; 92.8% on LongMemEval-S (best of 3), with the same model as reader and judge. | Provenance spans let claim validation trace back to exact source text. |
| Temporal Validity on Real Software Histories (Yadav, Yad26b) | 2026-08-21 | [arXiv:2608.20685](https://arxiv.org/abs/2608.20685) | Deterministic supersession reached 0.91 accuracy versus 0.57-0.59 for RAG, which served superseded values 36-38% of the time; only about 18% of real fixes are clean atomic transitions. | Use deterministic supersession for identifiable values, accepting limited coverage. |
| TEPA (Zhou, Zho26e) | 2026-08-07 | [arXiv:2608.07429](https://arxiv.org/abs/2608.07429) | Under full reversal, append-only and last-write-wins memory both score 0.210, no memory 0.309 and TEPA's keyed revocation 0.950. | An append-only store needs a revocation state on top. |
| Presentation, Not Mechanism (Jiang, Jia26h) | 2026-07-17 | [arXiv:2607.16019](https://arxiv.org/abs/2607.16019) | A revision ledger's apparent +0.182 came mostly from easier presentation (mechanism residual +0.021 to +0.025); with presentation controlled, coarse invalidation beat the fine ledger by 0.084 on current-state queries. | Use the coarsest invalidation that covers the queries and hold presentation fixed in evaluation. |
| Does Your Agent's Memory Survive a Model Upgrade? (Goyal, Doe26) | 2026-09-04 | [arXiv:2609.05339](https://arxiv.org/abs/2609.05339) | A fixed-schema graph transferred across a writer swap while LLM-written notes shifted +9.91 or -13.28 pp; a mixed embedding index recovered 4.96 of 11.90 pp; with raw history kept, 34 of 48 cases recovered. | Re-embed fully on an embedder change and keep raw sessions for repair. |
| Filesystem-Based Memory (Zhou, Zho26m) | 2026-07-29 | [arXiv:2607.26637](https://arxiv.org/abs/2607.26637) | Agent-managed Markdown directories halve retrieval cost on large material, but organisation erodes as the store grows and no agent turns it into better answers. | Agent-curated notes are a derived view, not the source of record. |
| Hidden Footprint (Yu, Yu26p) | 2026-07-13 | [arXiv:2607.11149](https://arxiv.org/abs/2607.11149) | Replaying one trajectory through seven frameworks gives a 6.7x storage spread; a content-addressed store cuts retained bytes 4.8-32.7x with reconstructability intact. | Store the lossless log content-addressed. |
| Memory in the Loop (Khan, Kha26m) | 2026-07-06 | [arXiv:2607.05690](https://arxiv.org/abs/2607.05690) | An in-process store answers in about 100 µs, with 0/12 redundant actions versus 7.2/12 at a 110 ms round trip; about 40 µs with a small local embedder. | Embed the store in-process with a small local embedder. |
| Memory as Infrastructure (Helwig) | 2026-08-31 | [arXiv:2609.05510](https://arxiv.org/abs/2609.05510) | A months-long record of 78,933 hook invocations and 85 recorded failures, none silent, with a session-start health gate and heartbeat telemetry; N=1, self-reported. | A health gate and heartbeat for the memory subsystem. |
| SuperLocalMemory 4.0 (Bhardwaj, Bha26) | 2026-08-08 | [arXiv:2608.08253](https://arxiv.org/abs/2608.08253) | Fault injection upheld 2,199 of 2,200 properties, but ten mechanisms were reachable yet ineffective; a governed write takes 11.0 ms. | Health checks need oracles independent of the mechanism, such as recall probes. |
| Governed Persistent Memory (Xu, Xu26d) | 2026-08-12 | [arXiv:2608.12476](https://arxiv.org/abs/2608.12476) | Source-bound admission with fail-closed release was correct on 2,400/2,400 clusters versus 600/2,400 for an ungoverned model. | Claim release fails closed on retracted, deleted or stale records. |
| MemTxn (Cui, Cui26) | 2026-07-30 | [arXiv:2607.27834](https://arxiv.org/abs/2607.27834) | Writes are validated against their source and journalled: 60/60 supported updates accepted, 179/179 hard negatives rejected, and the full active map restored under persistent faults. | Seat writes pass a source-support check and are journalled. |
| MemTX (Li, Li26j) | 2026-07-27 | [arXiv:2607.23929](https://arxiv.org/abs/2607.23929) | Snapshot-isolated belief commits gate irreversible tool calls; invariants checked over 5.5M protocol states with zero violations, and the only method with zero downstream harm. | Separate written from committed belief before a memory item drives an irreversible action. |
| Transactional Continuity Kernel (He, He26e) | 2026-08-12 | [arXiv:2608.11632](https://arxiv.org/abs/2608.11632) | Untrusted components propose typed changes against an exact predecessor head, recorded as Commit, Reject, Quarantine or Defer; 2,808,230 states explored with zero invariant violations. | Use compare-and-swap on a predecessor head for concurrent seat writes, with quarantine as a state. |
| D²ACCI (Liu, Liu26p) | 2026-08-18 | [arXiv:2608.17756](https://arxiv.org/abs/2608.17756) | Memory changes are promoted, flagged or rejected on paired statistics and protected slices; 93.59% on LoCoMo, and diagnostic artifacts reach 98-100% DCR@3 versus 0% for result-only logs. | Ship memory changes behind paired regression checks with stage-level traces. |
| Stored Is Not Supported (He, He26i) | 2026-09-02 | [arXiv:2609.02127](https://arxiv.org/abs/2609.02127) | On 24 hand-authored cases, typed provenance mediation released 0 of 19 unsafe candidates unqualified, while flat rules released 19/19. | Presence in memory is not support; a claim needs accepted evidence and current validity. |
| When Stale Constraints Go Unchecked (Nakayashiki, Nak26) | 2026-08-26 | [arXiv:2608.25553](https://arxiv.org/abs/2608.25553) | Under a two-record budget, 16 LLMs made stale-consistent decisions in about 75-77% of episodes; a one-sentence rule to prefer memories that state a limit recovered 89.3 pp. | The claim validator prioritises re-checking memories that carry constraints. |
| Keep It InMind (Li, Li26ag) | 2026-07-27 | [arXiv:2607.24368](https://arxiv.org/abs/2607.24368) | With the decisive memory in context the backbone answers 84.0% of indirect queries; when it must be retrieved, six systems reach at most 14.4%. | Pin standing constraints as always visible rather than retrieved. |
| Shared Selective Persistent Memory (Pedada, Ped26) | 2026-07-10 | [arXiv:2607.09493](https://arxiv.org/abs/2607.09493) | Keeping specifications, schemas and constraints while discarding reasoning traces gave 96% completion versus 79% with no memory and 71% with full history. | Even with lossless storage, injection into prompts must be selective. |
| LeanMem (Liao, Lia26c) | 2026-08-04 | [arXiv:2608.03463](https://arxiv.org/abs/2608.03463) | Routes content into profile, event or source-grounded record memory; up to 15.1 points above the strongest baseline at the lowest or near-lowest cost. | Typed stores cut cost without discarding evidence. |
| Dependency-Guided Rollback Repair (Yu, Yu26d) | 2026-08-11 | [arXiv:2608.10502](https://arxiv.org/abs/2608.10502) | A memory-to-action provenance graph recovered 85.3% of 150 cases versus 77.3%, with claim-invalidation F1 0.669 versus 0.603. | Propagate a retraction through derived claims, figures and ledger entries. |
| A-TMA (Shi, Shi26d) | 2026-07-02 | [arXiv:2607.01935](https://arxiv.org/abs/2607.01935) | Labels records current, historical or transition to counter "ghost memory"; +0.240 conflict accuracy on LTP, with host-dependent gains. | Expose state labels to the reader. |
| TRACE temporal evidence graphs (Wang, Wan26x) | 2026-07-01 | [arXiv:2607.00339](https://arxiv.org/abs/2607.00339) | Obsolete facts stay available for historical queries but are discounted for current-state ones through validity annotations. No numbers. | One store answers both "what was believed then" and "what holds now". |
| Graph-Native Bitemporal Store (Niksarli, Nik26) | 2026-07-29 | [arXiv:2607.26520](https://arxiv.org/abs/2607.26520) | Immutable identity nodes with valid and transaction time; 80% on knowledge updates in 60 questions, while a time-travel post-filter cut temporal recall from 50% to 37.5%. | Filter by time before vector search, not after. |
| ChronoMem (Su, Su26d) | 2026-07-30 | [arXiv:2607.27773](https://arxiv.org/abs/2607.27773) | A whole-memory snapshot per write, with natural-language undo mapped to versions. No numbers. | Offer "as of version" views and undo over project memory. |
| StateFuse (Volkov, Vol26) | 2026-07-07 | [arXiv:2607.05844](https://arxiv.org/abs/2607.05844) | CRDT merge with immutable history and explicit conflict objects; accuracy ties, but contradictions stay visible and abstention is safer. | Surface write conflicts between seats as objects. |
| MELD (Lovén, Lov26) | 2026-08-17 | [arXiv:2608.16357](https://arxiv.org/abs/2608.16357) | Claim-level CRDT status reconverged in 30/30 partition trials versus 11/30 for last-writer-wins; merge classifier AUC 0.968. | If memory syncs across machines, use claim-level CRDT status. |
| TARL (Xiao, Xia26g) | 2026-08-04 | [arXiv:2608.03699](https://arxiv.org/abs/2608.03699) | Five actions over accepted, pending and rejected ledgers improve state recovery. No numbers. | Unverified claims wait in a pending ledger. |
| MutMem (Saidi, Sai26b) | 2026-08-03 | [arXiv:2608.02843](https://arxiv.org/abs/2608.02843) | Signed, hash-committed mutations with a median of 4.865 ms; 0/100 poisons reached the top 5 versus 94/100 when the label policy was bypassed. | Tamper-evident mutations cost milliseconds. |
| MutMem-V2 (Saidi, Sai26) | 2026-09-01 | [arXiv:2609.01235](https://arxiv.org/abs/2609.01235) | A portable verification contract; independent Node and Python verifiers agree on all 72 terminals. No claim of semantic truth. | A model for an independently verifiable audit format. |
| Agent-Native Telemetry (He, He26g) | 2026-08-17 | [arXiv:2608.16178](https://arxiv.org/abs/2608.16178) | A hash-chained ledger of state deltas cut wire payload 96.4% and detected all 500 storage mutations. | Record memory health telemetry as signed state deltas. |
| Agent Zero Memory (Wu, Wu26m) | 2026-08-30 | [arXiv:2608.29606](https://arxiv.org/abs/2608.29606) | Answers may cite only evidence the reader opened; 95.60% on LongMemEval, and across eight backbones accuracy varies 3.4 points while cost varies about 30x. | A citation lock fits claim validation, and cheaper seats can serve memory queries. |
| RAG Deserves an Index (Wild, Wil26) | 2026-08-21 | [arXiv:2608.20845](https://arxiv.org/abs/2608.20845) | Provenance-validated claims compiled at ingest scored 85.2% at about 2.2k reader tokens versus 72.5% at 16.3k for the best chunk setup; incremental updates are 33.7x cheaper than rebuilds. | Claims compiled at ingest serve validation if source links are kept. |
| Activity Frames (Iyamu, Iya26) | 2026-08-06 | [arXiv:2608.05784](https://arxiv.org/abs/2608.05784) | A deterministic compiler reduces a day of activity 86x in 68 ms, and an agent answers 98.4% of questions versus 66-80% from an LLM summary. | Deterministic session digests beat LLM summaries and are auditable. |
| Paritok-4B (Shi, Shi26f) | 2026-08-25 | [arXiv:2608.24188](https://arxiv.org/abs/2608.24188) | An extractive compressor copies 96.0% of emitted identifiers and numbers from its input and keeps 86.5% of solve quality at 25.7% of the context. | Any compression must be extractive so exact identifiers and numbers survive. |
| Self-GC (Hao, Hao26) | 2026-07-01 | [arXiv:2607.00692](https://arxiv.org/abs/2607.00692) | Prunes 43.95% of prefix tokens with 84.85% of continuations unaffected, keeping recoverable sidecars; input tokens down 10-15% in production. | Context pruning stays recoverable through pointers into the log. |
| CrystalMem (Wu, Wu26f) | 2026-07-31 | [arXiv:2608.00303](https://arxiv.org/abs/2608.00303) | After a budget squeeze, capability does not return ("memory hysteresis"); demotion across fidelity states with verified rebuild matches the strongest full-budget baseline from a 50% budget. | Demote to lower-fidelity views but keep what is needed to rebuild. |
| What to Keep, What to Forget (Colaco, Col26) | 2026-07-09 | [arXiv:2607.08032](https://arxiv.org/abs/2607.08032) | A rate-distortion survey: keep-signals discard information before the query is known, with no undo, and repeated compaction is rarely measured. | Supports a lossless log with reversible compaction tested over repeated rounds. |
| Context Compression Instability (Min, Min26) | 2026-08-06 | [arXiv:2608.06503](https://arxiv.org/abs/2608.06503) | Recurrent compression increases blocked actions, repeated exploration and variation across runs. No numbers. | Evaluate compaction event by event, not only by end-task score. |
| MemForest (Wang) | 2026-09-08 | [arXiv:2609.08273](https://arxiv.org/abs/2609.08273) | Merging redundant memory nodes compresses 50% of history while retaining 97.1% of performance under Mem0, with a 1.89x retrieval speed-up. | Lossy compression is acceptable for derived views only. |
| LycheeMemory V2 (Li, Li26an) | 2026-08-13 | [arXiv:2608.12990](https://arxiv.org/abs/2608.12990) | Consolidating at semantic segment boundaries reaches 89.22% on LoCoMo and 92.20% on LongMemEval-S and cuts construction tokens by 86.0% and 75.9%. | Consolidate per task or session boundary, not per turn. |
| Agent Retrieval Bench (Qin, Qin26b) | 2026-07-27 | [arXiv:2607.24882](https://arxiv.org/abs/2607.24882) | No retrieval family dominates across 25 repositories, and logged agent trajectories miss every gold file on 27-35% of samples. | Keep lexical, dense and structural retrievers side by side. |
| LINE Conversation History Retrieval (Hattori, Hat26) | 2026-08-28 | [arXiv:2608.27809](https://arxiv.org/abs/2608.27809) | Hybrid BM25 plus dense retrieval reached Recall@5 0.697 versus 0.584 for the best single retriever; single user, configuration chosen on the test set. | Hybrid fusion is a reasonable baseline. |
| Compact-Memory Agents (Geng, Com26) | 2026-09-04 | [arXiv:2609.04915](https://arxiv.org/abs/2609.04915) | 83% of full-context quality at 32% of the tokens, and on par with BM25-RAG on RealMem (+0.27 pp, p=.47). | BM25 remains a strong baseline at small budgets. |
| When Users Don't Ask, LOCOMO-CONV (Chang, Cha26f) | 2026-09-03 | [arXiv:2609.03467](https://arxiv.org/abs/2609.03467) | Multi-facet query rewriting narrows retrieval gaps for raw-turn memory but not for abstractive memory. | Raw-turn stores benefit from query rewriting. |
| Controlled Memory Interference (Ding, Din26c) | 2026-08-07 | [arXiv:2608.07622](https://arxiv.org/abs/2608.07622) | Interference between specific memory relationships suppresses update plasticity, and lexical and dense retrieval show different interference pathways. No headline numbers. | Stress-test the BM25 and dense paths separately with conflicting updates. |
| Memory as a Controlled Process, MemCon (Jiang, Jia26d) | 2026-07-15 | [arXiv:2607.13591](https://arxiv.org/abs/2607.13591) | A tabular UCB bandit decides when and how much to retrieve and consolidate; up to +15.2 points in task success with 5-20% fewer tokens. | A cheap locally learned retrieval policy can tune memory use. |
| Why Git Is the Memory Solution (Guo, Guo26i) | 2026-07-15 | [arXiv:2607.14390](https://arxiv.org/abs/2607.14390) | Memory bound to version control; single-shot retrieval gives 0.07-0.20 answer sufficiency while routed decision synthesis reaches 0.83. | Anchor project memory to commits. |
| MOSS (Lacasse, Lac26) | 2026-07-05 | [arXiv:2607.04391](https://arxiv.org/abs/2607.04391) | A year-long single-scholar deployment (about 44M tokens) of logged relational retrieval with concepts induced from the corpus; no controlled benchmark. | SQLite-class stores scale to a researcher's corpus; corpus-induced concepts inform the profiler. |
| TrajWiki (Sun, Sun26c) | 2026-08-02 | [arXiv:2608.00967](https://arxiv.org/abs/2608.00967) | Immutable snapshots with add, revise and deprecate operations and a wiki compiled from them, routed back to source messages. No numbers. | A wiki is a navigable projection linked to raw messages. |
| TGMS (Zhang, Zha26aw) | 2026-07-11 | [arXiv:2607.10265](https://arxiv.org/abs/2607.10265) | Numeric and entity claims are checked against a content-addressed trace; the verifier caught all 500 injected errors with no false positives. | Numbers in reports can be verified mechanically against a content-addressed trace. |
| LLMs Interpret, Embeddings Organize, Graphs Emerge (Ran, Ran26) | 2026-08-30 | [arXiv:2608.29612](https://arxiv.org/abs/2608.29612) | Each ingest becomes an inspectable graph delta linked to the source record; case study of 56 papers, no accuracy benchmark. | A precedent for a per-ingest scientific-knowledge compiler. |
| Valhalla (Zheng, Zhe26g) | 2026-08-15 | [arXiv:2608.15193](https://arxiv.org/abs/2608.15193) | A five-layer file-to-graph model that preserves source identity, validated on an antibody-design review of 26 papers; no benchmark. | File identity at the base, derived knowledge views above. |
| NapMem (Xu, Xu26m) | 2026-07-07 | [arXiv:2607.05794](https://arxiv.org/abs/2607.05794) | Raw conversations, typed records, topic tracks and profiles linked by provenance and exposed as tools; competitive on three benchmarks. | Expose memory granularities to seats as tools, with the raw log at the bottom. |
| EvoGraph-Mem (Qian, Qia26c) | 2026-08-03 | [arXiv:2608.11248](https://arxiv.org/abs/2608.11248) | Ablations show append-only insight memory is insufficient over long horizons. No numbers. | Keep the raw log append-only but make the distilled-lessons layer editable. |
| Replicating Belief, Not Bits (He, He26f) | 2026-07-03 | [arXiv:2607.09748](https://arxiv.org/abs/2607.09748) | Separates an immutable evidence log from an evolving belief lineage with verifiable rollbacks; preliminary simulations only. | A conceptual basis for derived, roll-backable beliefs. |
| Parsing the Stream (Pakhomov, Pak26) | 2026-09-01 | [arXiv:2609.01466](https://arxiv.org/abs/2609.01466) | One append-only ledger folded into per-consumer views answers monitoring questions with about 14-15x fewer tokens; tasks were co-designed with the system. | One log feeds both the run-monitor view and the agent's working state. |
| Turning Interaction History into Execution State (Wang, Wan26au) | 2026-08-01 | [arXiv:2608.00808](https://arxiv.org/abs/2608.00808) | A deterministic ledger of what was observed, modified and attempted raised SWE-bench Verified Pass@1 from 56.2% to 64.2% and from 75.8% to 81.0% at lower cost. | An explicit execution-state view stops seats acting on stale observations. |
| EvoMem (Wang, Wan26as) | 2026-07-19 | [doi:10.1145/3805712.3809931](https://doi.org/10.1145/3805712.3809931) | A timeline projection over retrieved traces tracks revisions and retractions and gives fewer outdated answers. No numbers. | Suppress retracted claims in multi-seat debates. |
| ContextSniper (Luk, Luk26b) | 2026-07-02 | [arXiv:2607.01916](https://arxiv.org/abs/2607.01916) | Intent-gated compact packets cut tokens by 51.5% and 38.9% for two agents on 50 tasks with resolution essentially unchanged. | Gate long tool output into packets while the full output stays in the log. |
| FluctlightDB (S, Gan26f) | 2026-07-10 | [arXiv:2608.12365](https://arxiv.org/abs/2608.12365) | An embedded engine with self-reported 99.0% LoCoMo evidence recall and parity with Chroma on SciFact. | An in-process engine is feasible, but the numbers need independent reproduction. |
| Total Recall at What Cost? (Pollertlam, Pol26) | 2026-08-12 | [arXiv:2608.11879](https://arxiv.org/abs/2608.11879) | A length-based cost model misses memory systems by 18-69%, accuracy spans 21-54%, and break-even ranges from tens of turns to never. | Measure per-seat serving cost together with accuracy. |
| MemoryCPT (Lei, Lei26) | 2026-08-05 | [arXiv:2608.04843](https://arxiv.org/abs/2608.04843) | Proposes a Quality-per-Cost metric for memory systems. No numbers. | Report quality per unit cost for seat-backed memory operations. |
| RAGU (Komarov) | 2026-07-13 | [arXiv:2607.11683](https://arxiv.org/abs/2607.11683) | Two-stage typed extraction and consolidation with a 7B extractor reaches evidence recall up to 0.84 versus at most 0.76 on GraphRAG-Bench Medical, running on a single GPU. | Graph construction needs a GPU-class model, so it is not a low-RAM default. |
| KVMem (Chai, Kvm26) | 2026-09-04 | [arXiv:2609.04852](https://arxiv.org/abs/2609.04852) | Pages KV state across GPU, host memory and NVMe to run 1M-token workspaces on a 24 GB laptop GPU; DeepSWE success from 43.8% to 48.4%. | Relevant only to local-model seats, and in conflict with the low-RAM goal. |
| PLACEMEM (Ganguly, Gan26b) | 2026-07-05 | [arXiv:2607.04089](https://arxiv.org/abs/2607.04089) | A position paper with a prototype of versioned memory capsules including KV state; no accuracy results. | Low priority for a desktop app with remote seats. |
| MRMS (Li, Li26al) | 2026-07-06 | [arXiv:2607.04617](https://arxiv.org/abs/2607.04617) | Structured records decide eligibility, vectors handle recall, and graph relations adjudicate support and supersession; no benchmark numbers. | A template that separates eligibility, recall and adjudication. |
| HiGram (Yue, Yue26c) | 2026-08-05 | [arXiv:2608.05095](https://arxiv.org/abs/2608.05095) | Coarse-to-fine graph memory with joint rewriting of units and dependencies. No numbers. | Rewriting belongs in a derived layer, never in the raw log. |
| GraphMemix (Li, Li26am) | 2026-08-27 | [arXiv:2608.26983](https://arxiv.org/abs/2608.26983) | Query-aware evidence forests for multimodal memory. No numbers. | Relevant if recall must cover figures from visual approvals. |
| MedCache (Ting, Tin26) | 2026-08-30 | [arXiv:2608.29528](https://arxiv.org/abs/2608.29528) | Temporal validity matters more than retaining more history, and partitioned views hide shared evidence. No numbers. | Project and grant views should overlap rather than partition. |
| MemChain (Ma, Ma26f) | 2026-07-27 | [arXiv:2607.24097](https://arxiv.org/abs/2607.24097) | A trained post-retrieval policy builds compact evidence traces. No numbers. | A later option that needs training. |
| MemLens (Wei, Wei26f) | 2026-07-28 | [arXiv:2607.25992](https://arxiv.org/abs/2607.25992) | A demo that values memory records and compares strategies on quality, latency and tokens; no results. | A memory inspector could show per-record value. |
| TwinMem-Agent (Wu, Wu26t) | 2026-07-17 | [doi:10.1145/3803437.3807664](https://doi.org/10.1145/3803437.3807664) | Episodic plus semantic memory across sequential issues; Pass@1 89.1% versus 60.0% at about 18x lower cost. | Cross-task experience memory helps recurring analysis pipelines. |
| Exp-SWE-Agent (Li, Li26au) | 2026-07-17 | [doi:10.1145/3803437.3807663](https://doi.org/10.1145/3803437.3807663) | Distilled factual and experiential hints raise the resolution rate from 42.7% to 47.5%. | Distilled experience gives modest gains on top of the raw log. |
| RetrievalRouter (Kuru, Kur26) | 2026-08-26 | [arXiv:2608.25625](https://arxiv.org/abs/2608.25625) | Routing each query among text, multimodal, dense and late-interaction pipelines is 2.5% more accurate and 12.4x faster than the best static pipeline. | Query-level routing can cut latency; it is not corpus-level schema selection. |
| EVENTFORGE (Lodhiya, Lod26b) | 2026-08-31 | [doi:10.30574/wjarr.2026.31.2.2105](https://doi.org/10.30574/wjarr.2026.31.2.2105) | Induces 393 events and 286 relations from 12 PDFs; no gold-standard evaluation. | Schema induction from papers is feasible but unvalidated. |
| Semantic and Quality-Aware Code Retrieval (Horváth, Hor26b) | 2026-07-10 | [arXiv:2607.09161](https://arxiv.org/abs/2607.09161) | On 15 judged queries, semantic retrieval reached nDCG@5 0.820 and the router picked the expected mode 15/15. | Weak, small-sample support for function-level chunking in code search. |

## Prose

The evidence supports a style panel that describes features and never gives an
authorship verdict. AI generation leaves a fairly stable footprint (entropy, lexical
diversity) while AI editing leaves a weaker one (Sha26j); false-positive rates range from
0% to 100% across 13 detectors on professionally edited non-native text (Par26e); light
refinement is flagged at 38-80% while humanised text evades detection (Kar26b); and
detectors degrade under domain, generator and language shift (She26, Per26b, Dev26). For
rewriting, the evidence supports small local models, bounded patch edits with locks on
numbers and citations, minimal-edit instructions and explicit labelled stance fields
(Cha26c, PatchWrite, arXiv:2609.04061, Kwo26), with epistemic markers from an editing
tutorial (Wha26b). Evidence is missing on Russian scientific prose (the nearest items are a
Russian study of student mathematics and a Bulgarian classifier), on compression-based
detectors (none of the post-July items tests one), on how users read a banded, abstaining
AI-style estimate, and on claim preservation by the 0.5B rewriter, which its paper does
not measure. The autistic-writing confound rests on a 2025 work (see background).

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| AI Writers Have a Consistent Stylometric Footprint, but AI Editors Do Not (Shan, Sha26j) | 2026-08-28 | [arXiv:2608.27855](https://arxiv.org/abs/2608.27855) | Across 8 LLMs and 5 domains, entropy and lexical diversity separate generated from human text; AI editing leaves a small shift in which lexical density dominates, and edited text is hard to separate from human text. | Report generated-like and edited-like signals separately and never turn AI-assisted editing into an authorship verdict. |
| Why AI Detection Fails for Academic Integrity (Karr, Kar26b) | 2026-08-06 | [arXiv:2608.11256](https://arxiv.org/abs/2608.11256) | Light "refine abstract" edits were flagged at 38-80% and unmodified 2023-2025 originals at 9-15%; scores track long-token and Academic Word List density; after humanisation fewer than 4% stayed flagged. | Show features and uncertainty, not pass or fail; report Academic Word List density as a confound. |
| Style as a Confound (Park, Par26e) | 2026-08-27 | [arXiv:2608.26710](https://arxiv.org/abs/2608.26710) | On 135,389 pairs of non-native manuscripts and their native-edited versions, false-positive rates ranged from 0.0% to 100.0% across 13 detectors, and the same edits moved detectors in opposite directions. | Any style score carries the editing and non-native confound and is not calibrated on native English alone. |
| Rethinking AI-Generated Text Detection: distribution shift (Shen, She26) | 2026-07-04 | [arXiv:2607.03680](https://arxiv.org/abs/2607.03680) | A fine-tuned RoBERTa matches specialised detectors in domain but degrades sharply under topic or generator shift and can give high-confidence machine labels to human text. | The estimate abstains out of domain. |
| ARB: Matched Authorship-Rewriting Benchmark (Perrone, Per26b) | 2026-07-31 | [arXiv:2607.29539](https://arxiv.org/abs/2607.29539) | At TPR@1%FPR, FastDetectGPT and Binoculars catch 91.2% and 93.5% of direct LLM text but only 30.8% and 15.1% of human text rewritten by an LLM. | Zero-shot scores say little about human drafts revised by an LLM, the common case in Arc. |
| IndicDetect (Devalla, Dev26) | 2026-08-30 | [arXiv:2608.29919](https://arxiv.org/abs/2608.29919) | In Hindi, Telugu and Tamil, training-free detectors degrade considerably under unseen generators and adversarial perturbation. No headline numbers. | Style estimates need per-language validation and abstain on unvalidated languages. |
| Small Is Enough: per-user LoRA style rewriting (Chakravorty, Cha26c) | 2026-07-31 | [arXiv:2607.29238](https://arxiv.org/abs/2607.29238) | LoRA adapters on 0.5B to 7B base models rewrite AI-edited text toward the user's style; the composite score plateaus at 0.69 across all sizes, and LLM judges rated outputs over 20% lower in AI-ness. Claim preservation is not measured. | A local 0.5B seat is feasible in low RAM; its AI-ness outcome must never become an acceptance target. |
| Explicit, Not Longer (Kwon, Kwo26) | 2026-08-07 | [arXiv:2608.06953](https://arxiv.org/abs/2608.06953) | Writing a claim's stance as a labelled field rather than an aside raised retention under compression by about 15 points (p=0.00005), replicated at +15.6 in a pre-registered run. | Store hedges and claim strength as explicit labelled fields in memory and in the prose locks. |
| Language editing in the AI era: epistemic integrity (Whang, Wha26b) | 2026-08-14 | [doi:10.6087/kcse.409](https://doi.org/10.6087/kcse.409) | A tutorial listing sentence-level markers that polishing can shift (reporting verbs, hedges, tense, evaluative words, scope markers) and discourse-level risks such as certainty drift. No quantitative results. | The marker inventory for the claim-strength lock. |
| Redesigning and Auditing Deep Research Writing (Hayashi, Hay26) | 2026-08-12 | [arXiv:2608.28643](https://arxiv.org/abs/2608.28643) | Claim-level audits expose failures that rubric scores hide; drafting from source-linked claims cut hallucination 2.6-4.5x and raised necessary-fact recall 1.2-1.7x. | Draft from source-linked claims and audit at claim level. |
| Tracking claim changes from preprint to publication (Yin, Yin26c) | 2026-07-01 | [doi:10.64898/2026.06.30.735556](https://doi.org/10.64898/2026.06.30.735556) | Across 72,644 preprint-publication pairs, model-rater agreement was κ=0.67 against κ=0.76 between humans; claims became more cautious twice as often as more confident (8.4% vs 4.2%). | A method and baseline for claim-shift diffs; an LLM judge at this agreement needs human review. |
| When Models Edit Too Much (Zhu) | 2026-09-03 | [arXiv:2609.04061](https://arxiv.org/abs/2609.04061) | Over-editing is widespread; a preservation instruction lowered average excess Levenshtein distance from 0.195 to 0.131 and raised Pass@1 by 2.3 points. | Track excess edit distance and instruct the rewriter to keep edits minimal. |
| Most biomedical publications show signs of LLM-assisted writing (Holzwarth, Hol26) | 2026-08-11 | [arXiv:2608.10715](https://arxiv.org/abs/2608.10715) | A corpus-level estimator finds excess LLM vocabulary in 89% of PMC open-access papers by the end of 2025, twice as likely in Discussion (68%) as in Methods (32%). | Excess-vocabulary hints are population estimates, never evidence about one manuscript. |
| Are Scientists Starting to Sound like ChatGPT? (Alani, Ala26) | 2026-07-27 | [doi:10.3390/make8080223](https://doi.org/10.3390/make8080223) | In 28,415 abstracts, strict marker use rose from 4.995 to 11.658 per 1,000 words (+133.4%), driven by value framing, contribution signalling and similar rhetoric. | Rhetorical categories can drive optional clarity suggestions, described as style. |
| Lexical Traces of AI (Comas Forgas, For26) | 2026-07-16 | [doi:10.1002/leap.2067](https://doi.org/10.1002/leap.2067) | 17 lexical items grew steeply from 2022 to 2024; the authors treat them as probabilistic markers with multifactorial causes, including imitation and editorial norms. | Overused-term hints must say that such terms also spread without AI use. |
| Temporal linguistic shifts in oncology RCTs (Silva, Sil26c) | 2026-07-24 (DOI created) | [doi:10.1016/j.ejca.2026.116963](https://doi.org/10.1016/j.ejca.2026.116963) | In 21,392 trials, post-LLM papers had more formulaic phrases (mean 0.96 vs 0.65, r=0.10), most in Discussion sections. | A weak population signal, never presented as evidence about a paper. |
| Beyond "AI Language": idiolectal LLM output (Rudnicka, Rud26) | 2026-08-06 | [arXiv:2608.06589](https://arxiv.org/abs/2608.06589) | Model cohorts from 2024 and 2026 differ generationally and each model keeps its own profile; contraction frequency within the 2026 cohort ranges from about 1,200 to over 30,000 per million words. | Style descriptors need versioning and are not a universal AI fingerprint. |
| EVIL-Detect, NLPCC 2026 (Bao, Bao26c) | 2026-08-11 | [arXiv:2608.10698](https://arxiv.org/abs/2608.10698) | For Chinese, edit-extent regression plus conservative calibrated fusion distinguished human, generated and refined text, ranking first with macro-F1 0.8888 under out-of-distribution shift. | Estimate edit extent in bands with conservative calibration, not a binary label. |
| Team DACTYL at PAN 2026 (Thorat, Tho26) | 2026-07-19 | [arXiv:2607.17382](https://arxiv.org/abs/2607.17382) | Data curation plus post-hoc calibration raised the mean PAN score to 0.974 (second place), with metrics that reward abstention. | Calibration with abstention matters; these models are too large for the low-RAM path. |
| Detecting AI-Generated Text and Code (Alluri, All26) | 2026-08-19 | [doi:10.3390/ai7080319](https://doi.org/10.3390/ai7080319) | Domain shift was the main failure (CodeBERT fell to 0.67 AUROC), and a unified detector beat a routed pipeline on mixed content (0.96 vs 0.75). | Any style signal on LaTeX-plus-code documents needs mixed-content testing. |
| Detection of AI-Obfuscated, Refined and Humanized Text: a systematic review (Sharimbayev, Sha26e) | 2026-08-11 | [doi:10.48084/etasr.20040](https://doi.org/10.48084/etasr.20040) | Across 26 studies, detectors are unreliable on paraphrased, humanised or co-edited text, with recurring fairness concerns for non-native writers. | Secondary support for treating any estimate as one signal, never a judgement. |
| Signs of machine generation in student works on higher mathematics (Kostrova, Kos26) | 2026-07-23 | [doi:10.30853/ped20260166](https://doi.org/10.30853/ped20260166) | 14 markers in five categories for Russian-context mathematics solutions; a 5-point threshold gave sensitivity 0.92 and specificity 0.84 on more than 1,000 works. | A rare Russian-context scheme; its specificity implies many false flags. |
| Detecting AI-Generated Bulgarian Text (Bogdanov, Bog26) | 2026-08 (month only; DOI registered 2026-08-11) | [doi:10.47810/jclib.2.2026.01](https://doi.org/10.47810/jclib.2.2026.01) | A two-step classifier first filters human text and then grades machine involvement. No numbers in the abstract. | The closest Cyrillic-language pattern; Russian still needs its own validation. |
| Linguistic features of AI-generated texts (Babkova, Bab26) | 2026-08-18 | [doi:10.20998/2227-6890.2026.1.10](https://doi.org/10.20998/2227-6890.2026.1.10) | Proposes markers for Ukrainian news and argues that detection should assist, not replace, expert analysis; no validation. | Can inform feature descriptions, not scoring. |
| Detecting AI-Generated Essays with Lexical Stylometric Features (Sumbula, Sum26) | 2026-07-30 | [doi:10.31436/ijpcc.v12i2.699](https://doi.org/10.31436/ijpcc.v12i2.699) | Lexical features reached 90-97.5% on 200 in-distribution essays, with no shift testing. | Cheap lexical features are computable locally; the accuracy does not transfer. |
| Zero-Shot Detection of IndoT5 Indonesian Abstracts (Syahputra, Sya26) | 2026-07-31 | [doi:10.56705/ijodas.v7i2.457](https://doi.org/10.56705/ijodas.v7i2.457) | AI text had higher sentence-length variation than human text (SD 15.44 vs 7.99), and zero-shot NLI produced 790 false positives among 1,137 human abstracts. | Do not hard-code "uniform text means AI" rules. |
| Detecting AI-Generated Text: mechanisms and limits (Kumar, Kum26f) | 2026-07-16 | [doi:10.55248/gengpi.07.0726.2103](https://doi.org/10.55248/gengpi.07.0726.2103) | A narrative review concluding that detectors cannot be the sole basis for integrity decisions; its numbers restate earlier studies. | Cite the primary studies rather than this review. |
| Detecting AI-generated academic language (Solidjonov, Sol26) | 2026-07-20 | [doi:10.1007/s43681-026-01284-z](https://doi.org/10.1007/s43681-026-01284-z) | No abstract was available, so no finding can be reported. | Unverified until the full text is read. |
| UTS at ELOQUENT 2026 Voight-Kampff (Galat) | 2026-07-15 | [arXiv:2607.13565](https://arxiv.org/abs/2607.13565) | Out-of-distribution structural shifts bypass adversarially fine-tuned detectors with up to about 50x higher fool rates, and augmenting training data with period prose does not close the gap. | Evading a detector is easy and says nothing about quality; never optimise against one. |
| SlopShape (Madler) | 2026-09-14 | [arXiv:2609.15369](https://arxiv.org/abs/2609.15369) | 187 structural features detect AI-generated commercial blog posts at 98.0 macro-F1 on held-out companies, unchanged (98.1) after rewording. Commercial web content only. | Structural features are candidate descriptors, unvalidated on scientific prose. |
| DWT-Fusion (Özdaş) | 2026-07-24 | [arXiv:2607.22026](https://arxiv.org/abs/2607.22026) | Wavelet analysis of token log-probabilities from a proxy model gives AUROC up to 0.9919 on HC3 but 0.7471 on MAGE. | Training-free scores degrade across datasets and need a proxy language model. |
| When Less is More: token filtering in detection (Han) | 2026-08-30 | [arXiv:2608.29903](https://arxiv.org/abs/2608.29903) | Keeping only 40% of tokens can be optimal for weak source models, but filtering fails for strong ones. | The behaviour of zero-shot signals depends on the generator. |
| How Much Were You Told? External information in peer reviews (Dubois) | 2026-09-23 | [arXiv:2609.28041](https://arxiv.org/abs/2609.28041) | An information-theoretic estimator separates fully delegated from machine-polished reviews with AUC up to 1.0 and is largely insensitive to surface rewriting. | Content-origin measures differ from style scores; not adopted as a verdict tool. |

## UI

Post-July work on overseeing agents moves from chronological logs to steerable
trajectories linked to claim-level evidence graphs (SciForge, LEDGER, AgentGUI). The
evidence supports colouring claims by verification density with contradiction checks
(d=1.82 in an idealised interface, arXiv:2609.03460), keeping per-action approval for
consequential actions because standing rules blocked 20.1 pp less overreach (Yan26y),
reviewing one or two actions at a time (Han26g), and computing risk outside the agent,
since 90% of failed runs ended with a success claim (CURA); deterministic gates held
under prompt injection where LLM judges flipped (BioFirewall). No post-July work tests
brutalist or neo-brutalist styling, English-Russian localisation, text expansion or
Cyrillic typography, and the accessibility evidence covers LLM-generated Android code and
user-side web repair, not desktop scientific tools.

| Paper | First posted | ID | Finding | Implication |
|---|---|---|---|---|
| Do User-Authored Permission Policies Improve Protection? (Yan, Yan26y) | 2026-08-27 | [arXiv:2608.27443](https://arxiv.org/abs/2608.27443) | With 113 participants, user-written rules blocked less overreach than per-action human approval (-20.1 pp, 95% CI -32.1 to -8.1) and automated review (-14.5 pp); prompts fell from 18.0 to 10.9, but total intervention time was not reliably lower. | Keep per-action review for consequential categories and flag approved actions outside the original request. |
| Beyond "Made with AI": Provenance Density (Zhang, Zha26bu) | 2026-09-03 | [arXiv:2609.03460](https://arxiv.org/abs/2609.03460) | An idealised display of verified-claim density produced a large truth-versus-fabrication discernment gap (+4.15 points, d=1.82, n=81); an audit found retrieval density alone insufficient and a consistency veto carried most of the signal. | Colour claims by verification density plus contradiction checks, never by author. |
| SciForge (Gao, Gao26f) | 2026-07-17 | [arXiv:2607.16038](https://arxiv.org/abs/2607.16038) | An open-source research workbench reserves the GUI for human judgement and review gates while services run as agent tools, with an Evidence-DAG audit sidecar; eight demonstrations, no user study. | The closest architectural peer; compare the approval gates against its review gates. |
| CURA: Certified Runtime Alarms (Kumar, Kum26i) | 2026-08-28 | [arXiv:2608.27808](https://arxiv.org/abs/2608.27808) | 64 of 71 failures (90%) ended with a success claim; an external telemetry monitor detected 42.3% of failures a median of 31 steps early at a realised false-alarm rate of 0.066. | Never show a seat's own "done" as success; compute alarms outside the agent with a false-alarm budget. |
| More Rejective, Not More Discriminative (Han, Han26g) | 2026-08-25 | [arXiv:2608.23941](https://arxiv.org/abs/2608.23941) | Longer review windows raised catches and false rejections together; informedness peaked at one or two actions for all six judges in both domains. | Review one or two items at a time and report false rejections beside catches. |
| LEDGER: claim-to-evidence trace graphs (Kim, Kim26c) | 2026-08-19 | [arXiv:2608.18398](https://arxiv.org/abs/2608.18398) | Groups trace records into evidence and workflow nodes with typed edges from claims to supporting actions, artifacts and checks. No quantitative evaluation. | The template for the evidence drawer on claim cards. |
| AgentGUI (Zhao, Zha26bt) | 2026-07-28 | [arXiv:2607.26300](https://arxiv.org/abs/2607.26300) | A local GUI for concurrent long-running agents let users find key trace elements 38% faster (p=0.023); drift prevention raised completion of small local agents by up to 34 pp. | A local trajectory view with steering fits the multi-seat desktop. |
| How Agents Ask for Permission (Michael, Mic26b) | 2026-07-15 | [arXiv:2607.13718](https://arxiv.org/abs/2607.13718) | A taxonomy from 21 permission proposals and five commercial agents covering specification, derivation and runtime enforcement. | Specify how each approval choice becomes an enforced policy per seat. |
| Janus (Brigham, Bri26) | 2026-07-01 | [arXiv:2607.01510](https://arxiv.org/abs/2607.01510) | Six permission assistants across three scenarios: user input strengthened privacy and security, AI help reduced load, and no design was best in every context. | Vary approval policy by action type and track approval fatigue. |
| SAFETY SENTRY (Chen, Che26ad) | 2026-07-15 | [arXiv:2607.13594](https://arxiv.org/abs/2607.13594) | A guard model routes each action to EXECUTE, ASK or REFUSE, with one threshold moving the risk tolerance without retraining. No numbers. | A three-way route with a tunable ASK threshold. |
| Allow to Achieve, Over-Privileged Inadvertently (Chen, Che26ac) | 2026-08-05 | [arXiv:2608.04755](https://arxiv.org/abs/2608.04755) | Changing only the requesting app's name moved agents' permission grants from 26/32 to 0/32, and task context overrode permission judgements. | Seats never grant themselves permissions; authorisation stays with the user or policy layer. |
| HRI Grounding: supervisory interface (Yu, Hri26) | 2026-09-02 (Crossref record created) | [doi:10.1109/lra.2026.3730218](https://doi.org/10.1109/lra.2026.3730218) | One control per plan step with a plain-language description, held until confirmed: 16 operators separated sound from faulty plans with d′=2.90 and recovered 85 of 96 missions. | Plan approvals use step-level approve and correct controls. |
| Real-Time Detection and Repair of Agent Failures (Dubey, Dub26) | 2026-08-03 | [arXiv:2608.02464](https://arxiv.org/abs/2608.02464) | Deterministic verification caught 60% of failures (96% with a coverage check) with 0 of 63 false positives; a statistical monitor needed recalibration (0.527 cold vs 0.885); rollback raised success from 52% to 73%. | Recompute stated results from actual tool outputs; calibrate statistical monitors per deployment. |
| Monitoring Web Agents Without Internal Signals (Pan, Pan26i) | 2026-09-02 | [arXiv:2609.02057](https://arxiv.org/abs/2609.02057) | Observable behaviour and intention-action consistency features predicted failure risk competitively with internal-signal baselines and transferred to held-out site categories. | Risk signals can be computed for API-only seats. |
| ClawSentry (Wang, Wan26aw) | 2026-08-21 | [arXiv:2608.21101](https://arxiv.org/abs/2608.21101) | A vendor-neutral gateway with skill admission review and a three-tier runtime check cut contextual attack success from 39.55% to 2.61% while task success moved from 83.78% to 83.05%. | A tiered gateway with admission review suits the Claude and Codex seats. |
| BioFirewall (Ali, Ali26f) | 2026-08-15 | [arXiv:2608.20413](https://arxiv.org/abs/2608.20413) | Under prompt injection, open-weight LLM judges flipped to allow in 3 and 5 of 6 trials, while the deterministic screen did not change; none of 288 legitimate plans was refused. | High-risk approvals rest on deterministic gates that cite evidence and log tamper-evidently. |
| U-Lens (Mei, Mei26) | 2026-07-12 | [arXiv:2607.10604](https://arxiv.org/abs/2607.10604) | Presenting uncertain parts of long responses as ranked inspection targets improved verification efficiency and lowered workload (n=18). | Present uncertainty as ranked, actionable targets rather than percentages. |
| One Human, N Agents: audit-budget allocation (Zavattari) | 2026-07-30 | [arXiv:2607.28317](https://arxiv.org/abs/2607.28317) | Past a miscalibration threshold, confidence-ranked auditing is worse than random; five open-weight LLMs showed near-constant confidence. | Do not order the approval queue by a seat's self-reported confidence. |
| Knowing Is Not Enough: information retrievability (Fu) | 2026-09-02 | [arXiv:2609.01976](https://arxiv.org/abs/2609.01976) | In two experiments with 640 employees, self-generated explanations improved error detection, and reactivation cues sustained it under repeated use. | Short self-explanations and review-time cues keep human checks effective. |
| Delegating or Doing? (Dizon) | 2026-08-20 | [arXiv:2608.19551](https://arxiv.org/abs/2608.19551) | AI assistance reduced clicks but not task time; users did not avoid delegating higher-risk actions, and delegation varied more between people than tasks (ICC=.50, n=73). | Approvals cannot rely on users avoiding risky delegation by themselves. |
| AI Agents Push Humans Out of the Loop (Mitchell, Mit26b) | 2026-08-24 | [arXiv:2608.23642](https://arxiv.org/abs/2608.23642) | A position paper arguing that current agent design impedes oversight and that extended AI use erodes the skills overseers need. | Approvals ask for active judgement rather than one-click confirmation. |
| The Oversight Fallacy (Passi, Pas26) | 2026-07-29 | [doi:10.69985/vwck1626](https://doi.org/10.69985/vwck1626) | Fieldwork in a computational biology lab: oversight needs knowledge of capabilities and limits, observation, meaningful control and timely intervention. | Show capability and limit cards for each seat beside its logs and stop controls. |
| From Prompt to Provenance, BloClaw (Qin, Qin26h) | 2026-09-01 | [doi:10.64898/2026.08.26.747436](https://doi.org/10.64898/2026.08.26.747436) | A capability registry declares each tool's state, constraints and what remains unvalidated, with a provenance-aware lab notebook; no benchmark results yet. | Capability cards state what a seat or tool cannot yet validate. |
| Artifact-centered Claim-aware Observability (Yin, Yin26) | 2026-08-18 | [arXiv:2608.18312](https://arxiv.org/abs/2608.18312) | A position paper: claims as first-class objects with evidence bindings and verification records, exported to PROV-O or RO-Crate. No evaluation. | Export claims and evidence as portable lineage. |
| LEDGERMIND (Du, Du26c) | 2026-07-30 | [arXiv:2607.28374](https://arxiv.org/abs/2607.28374) | Reasoning may cite only active ledger entries, with numeric grounding checks and a formal non-amplification guarantee. No numbers. | Every number in prose and LaTeX cites a ledger entry. |
| AgentTrails (Wu, Wu26l) | 2026-07-21 | [arXiv:2607.18816](https://arxiv.org/abs/2607.18816) | Turns trajectories into provenance graphs and aligns several runs on one canvas for comparison. No user study. | Let users compare how different seats solved the same task. |
| Sidekick (Chang, Cha26g) | 2026-07-20 | [arXiv:2607.17527](https://arxiv.org/abs/2607.17527) | Ambient cues, summaries on resumption and visible reasoning gave better multitasking than chat baselines (n=30). | Offer a summary of what happened while the user was away. |
| AI Scientist Mission Control, AIMC (Pal, Pal26) | 2026-08-10 | [arXiv:2608.28637](https://arxiv.org/abs/2608.28637) | Visual analytics cluster recurring weaknesses across many AI-generated papers; a case study without a user study. | Aggregate weakness views could help triage the claim queue. |
| Quantifying Visual Complexity in AI-Designed UIs (Vardar, Var26b) | 2026-08-05 | [doi:10.3390/electronics15153458](https://doi.org/10.3390/electronics15153458) | With 62 participants, raw AI-generated UIs had 63.10% task accuracy versus 100% for human and prompt-optimised UIs, and pixel complexity metrics correlated only weakly with outcomes. | Test dense screens with people; computed complexity scores are not enough. |
| How Source Attribution Visualization Shapes Attention (Cho) | 2026-08-14 | [doi:10.3390/jemr19040089](https://doi.org/10.3390/jemr19040089) | In an eye-tracking study (N=23), card lists were discovered almost immediately and raw links last, yet no self-reported measure differed; inline chips drew about half the dwell time. | Measure attention and preference together; map sources to sentences with in-place preview. |
| What Do We See First? Proximity-compatible layout (Ravichandran, Rav26b) | 2026-08-31 | [doi:10.1177/10711813261484494](https://doi.org/10.1177/10711813261484494) | A dashboard redesigned on the proximity compatibility principle gave faster task completion (g=0.87) and orienting (g=0.81) with 26 participants. | Place each alarm beside its evidence and its action controls. |
| Not Always Top-Left: dashboard reading order (Sultanum, Sul26) | 2026-08-07 | [arXiv:2608.06845](https://arxiv.org/abs/2608.06845) | Reading order depends on layout, salience, semantics, functional role, interaction and context (18 authors, 16 users). | Critical alarms need salience and grouping, not only a top-left position. |
| Serial processing for surveillance interfaces (Pelletier, Pel26b) | 2026-08-10 | [doi:10.1080/00140139.2026.2713756](https://doi.org/10.1080/00140139.2026.2713756) | With 128 participants, one feed at a time improved situation awareness without raising workload, and detection did not differ. | Prefer a single-focus view with progressive disclosure over a wall of live seat streams. |
| Information presentation speed in SCADA interfaces (Tong, Ton26b) | 2026-07-01 | [doi:10.1080/00140139.2026.2686854](https://doi.org/10.1080/00140139.2026.2686854) | With 20 operators, presentation speeds above 8°/s significantly increased errors. | Cap the motion speed of live streams and animated status. |
| Designing for all? Accessibility of LLM-generated Android UIs (Rabelo, Rab26) | 2026-07-30 | [doi:10.1007/s10209-026-01373-0](https://doi.org/10.1007/s10209-026-01373-0) | Four studies found 702 accessibility issues; prompts that explicitly asked for accessibility often introduced more problems, and English prompts produced fewer errors. | Check the accessibility of model-written UI code with automated audits rather than prompts. |
| From Blind Edits to Verified Repair (Wanscher) | 2026-07-26 | [arXiv:2608.24913](https://arxiv.org/abs/2608.24913) | Unverified CSS generation improved and regressed pages at similar rates (24 vs 20); an audit-inject-verify loop that accepts a change only if violations strictly decrease detected 57/57 seeded violations and rejected 126/126 harmful candidates. | Accept style and palette changes only after an automated accessibility audit shows no new violations. |
| Computer-Use Agents for Blind Users (Kodandaram) | 2026-09-01 | [arXiv:2609.00524](https://arxiv.org/abs/2609.00524) | In a three-week diary study with 8 blind users (1,258 commands), GPT-5 had the highest success rate at 52.5%. | Screen-reader users cannot rely on agents to operate the UI; the UI itself must stay accessible. |
| RaivenTracks (Hugie, Hug26) | 2026-08-14 | [arXiv:2608.14869](https://arxiv.org/abs/2608.14869) | Validated visualisation specifications kept as branchable checkpoints; all 3 pilot participants used the tree for branching and recovery. | Approve versioned, recompilable figure specifications rather than static images. |
| DEEPCHART (Tang, Tan26m) | 2026-08-27 | [arXiv:2608.26757](https://arxiv.org/abs/2608.26757) | In 1,482 chart tasks, plausible-looking charts often hide data-level hallucinations in extraction and reasoning. | Figure approvals check the data behind each chart, not only the image. |
| Networked Intelligence, Mycelium (Choudhury, Cho26c) | 2026-07-14 | [arXiv:2607.13220](https://arxiv.org/abs/2607.13220) | A shared workspace routes each observation to the person or agent whose next decision it informs; a case study without controlled metrics. | Local memory could route new findings to the seat or task they affect. |

## Design decisions and their basis

"Supported" means at least one post-July study above bears directly on the decision.
"Partly supported" means the evidence is indirect, comes from a single small study or
covers only part of the decision. "Design judgement" means no post-July evidence in this
dossier bears on it. "Standard" means the basis is a standard listed under background.

### Behavioural HoH

| Decision | Basis | Standing |
|---|---|---|
| Task router picks a profile variant per task family and records its id and digest | Per-family harnesses through a fixed seam (Zho26f); routing per task at admission (Raj26b); task-conditioned harnesses in fixed interfaces (Zha26ag). Learned routers are brittle or no better than fixed tiers (Vid26, Vid26b, Kum26g). | Partly supported. A learned router is trusted only if it beats a fixed-profile baseline, and a static fallback stays. |
| Profile tree with variants per family and per seat | Archive of variants (Zha26w); gains are model-specific (Luo26e) and model-dependent (arXiv:2609.01437). | Supported. |
| Governed substrate, free strategy | Prime Agent (arXiv:2608.23552); runtime adaptation inside a fixed substrate (Yu26f); evolution confined to memory and state (Du26). | Supported. |
| Changes are trace-diagnosed structured patches tagged by harness role and obligation | Targeted patches from diagnosed traces (Par26); role and obligation taxonomy (Wan26d); edits as falsifiable contracts (Yan26k); cited failures must be verified (Wan26g). | Supported. |
| Quality, no-regression and retention gates before commit | Jia26; Kan26c; harness-induced forgetting (Evo26); pre-commit admission because rollback cannot undo contamination (Sha26c); deterministic regression constraints (arXiv:2608.10471). | Supported. |
| Three-way split: search, hidden selection, held-out | Esa26; Urs26b; Jia26; poor held-out generalisation without it (Wan26ac); agents exploit visible shortcuts (Pra26). | Supported. |
| Validation only on affected task types | Xu26g; adaptive task sampling (arXiv:2608.20169). | Supported. |
| A seat or tool change triggers regression replay; a model change triggers re-validation | Evo26; arXiv:2609.01437; Luo26e; the harness dominates measured capability (Wha26). | Supported. |
| Verified undo for every change | Sah26; reversible component-level updates (Mao26b). | Supported. |
| "Report defect" action for seats | Escalation tool plus explicit policy cut reward hacking from 23.6% to 5.3% (arXiv:2608.29460). | Supported, on condition that the action is paired with an explicit policy. |
| Evaluators, ledger and ladder in a digest-pinned module the evolver can neither read nor write | Sealed audit (Guo26); tampering persists in lineages (Wan26d); models "repair" evaluators when allowed (Luo26c); sealed held-out boundary (Urs26b); in-band judges accept regressions (Par26g). | Supported. |
| The user approves each change; lineage allows rollback | Highest verification levels granted only by humans (Kre26); verified undo (Sah26). No study measures human approval of harness changes. | Partly supported; the approval step is a design judgement. |
| Nothing enters shared memory without passing its gate | Skill contamination (Sha26c); exploit spread through shared memory (Pag26); memory as an attack carrier (Zha26bb). | Supported. |
| Proposals carry grounds and a rationale of at most 400 characters | Tagging items as supported, inferred or unresolved (Liu26h); typed proposals to a code-owned executive (Arj26). | Partly supported; the 400-character limit is a design judgement. |

### Validation ladder L0-L5

| Decision | Basis | Standing |
|---|---|---|
| L0 Asserted: model text only | Passed AI review is not evidence (Mia26b); self-reports of success are unreliable (Kum26i, Par26g). | Supported as the floor. |
| L1 Traced, with fidelity audit, evidence-ledger label, retraction check and provenance audit | Fidelity audit (Yu26); trace graphs (Kim26c, Hir26); ledger labels at 0.676 accuracy with a third of supported claims flagged (Che26); provenance audit (Gye26); models do not reject unreliable literature (arXiv:2608.11415); one metric ledger (Zha26bf). | Supported. The retraction lookup through OpenAlex or Europe PMC is a design choice that the evidence motivates but does not test. |
| L2 Recomputed in a clean worker against tolerance rules fixed beforehand | Fixed acceptance rules (Han26); reruns from scratch under a hidden evaluator (Chi26); deterministic replay (Liu26z); replay preconditions and evidence bound at commit (Sol26b, Qin26c). | Supported. |
| L3 Pre-specified: prediction, analysis and falsifier hash-locked before observation | Lit2Test (arXiv:2608.22948); immutable prediction cards (Zha26s); hash-bound pre-registration (arXiv:2608.10858); pre-registered predictions (Arj26). | Supported. |
| L4 Severe: refutation criterion, null model, assumption checks, sealed holdout behind a budgeted interface | E-value nulls (arXiv:2608.06621); matched null search (Che26y); semantics-free baseline (Yao26c); assumption checks (Mia26); protected holdout (He26); confirmation data (Xu26f); multiple comparisons (Lee26c). | Supported for the components; the budgeted holdout interface is a design judgement. |
| L5 Replicated or external: independent implementation, independent data or method, or an attached lab result | Implementation variance exceeds rerun variance 5-10x (Nin26); agents omit cross-dataset tests (Tru26); metric gains are not mechanisms (Rao26). | Supported for independent implementations; lab results lie outside this evidence base. |
| Claim verdicts: accepted, qualified, revised, blocked, rejected or deferred | Che26x; withheld findings (Zhu26); a confirmation-pending state (Sch26b). | Supported. |
| Pitfall checklist | Failure taxonomy (Fei26); research failure modes (Kir26). | Supported. |
| Every number in prose and LaTeX resolves to an artifact | Zha26bf; Li26c; TGMS (Zha26aw); LEDGERMIND (Du26c). | Supported. |
| Hidden text is stripped before any review | No post-July source in this dossier. | Design judgement. |
| Release requires a minimum rung per claim type | Claim kinds need different checks (Shi26b). | Partly supported; the thresholds are design judgements. |
| Agreement between seats never raises a rung | Correlated false negatives (arXiv:2608.20607); same-model debate (arXiv:2608.00243); asymmetric debate bias (Son26c); passed reviews of divergent analyses (Mia26b). | Supported. |
| Reviewer from a different model family where available | 52% to 64% in a 100-problem pilot with self-review falsely rejecting 35% (arXiv:2609.04270); cross-vendor audit (Don26). | Partly supported: one pilot and one seeded-defect trial. |
| A judge may block only by citing a rule | CrossAudit (Don26); deterministic gates hold where LLM judges flip (Ali26f). | Supported by one seeded-defect trial, in which two vendors read the same rulebook differently. |

### Visual approvals

| Decision | Basis | Standing |
|---|---|---|
| Blocking deterministic checks: geometry, clipping, minimum font size, DPI, contrast, LaTeX log, font embedding and margins | Deterministic gates plus bounded repair (Hu26); no model reaches 60% on atomic perception (arXiv:2607.24957); VLM coordinates unusable (Ras26b); hard layout gate (Tia26); PDF text consistency (Ven26b). | Supported. |
| UI checks by screenshot plus DOM at several zoom and DPI settings | Guo26b; pixel-versus-structure consistency gate (Zha26f). | Supported. |
| Advisory VLM, blind to other judges and to code results | Forged peer judgments (Shu26); figures lower reviewer error detection (Alh26). | Supported. |
| The VLM may answer "can't read" | Hallucination of unreadable content in 96% of cases for one model, abstention in 71% for another (Oam26). | Supported. |
| VLM verdicts re-checked on a semantics-preserving re-render | Re-rendering is a better diagnostic than resampling but not proof (Kha26); equivariance catches errors invariance misses (Kha26f); matched controls (Zhe26c). | Supported as a diagnostic only. |
| The VLM can open issues but never close them | Triage precision of 62.5% (Cri26); VLMs as high-recall filters (arXiv:2607.25921); poor bug-finding (Hon26). | Supported. |
| Human sign-off, one or two items at a time | Informedness peaks at one or two actions for pre-execution review (Han26g); single-focus views improve situation awareness (Pel26b). | Partly supported, by analogy from action review and monitoring. |
| Each approval shows the baseline, the pixel diff and a "what changed" note | Change captioning helps but is fallible on dense screens (Zha26g); out-of-target drift (Li26k). | Supported; the note is treated as fallible. |
| Receipts bind to candidate digests and go stale when the candidate changes | Proof-or-Stop (Hua26j). | Supported. |
| Requirement tracking across rounds | Forgetting of implemented features across turns (Wu26g). | Supported. |
| Human approval is mandatory before release | Ras26b and Cri26 recommend human verification; no study validates an end-to-end sign-off workflow. | Design judgement. |

### LaTeX studio (PatchWrite protocol)

| Decision | Basis | Standing |
|---|---|---|
| Agent edits are single lines or bounded spans, with a registry locking cite keys and numbers | PatchWrite (Yan26g). | Supported. |
| An edit is accepted only if it compiles and nothing outside the target changed | Yan26g; compiling repairs still change text in 13.6-18.5% of cases (Ven26); out-of-target drift (Li26k). | Supported. |
| The affected page is re-rendered and checked for layout after each edit | ReDeck (Tia26). | Supported. |
| The best version is kept, with automatic rollback | Strict-peak rollback (arXiv:2608.24103); final rounds often worse than an earlier best (Zhu26). | Supported. |
| Data figures are only ever inserted from real artifacts | Placeholder-first contract (Yan26); hidden data-level hallucinations in charts (Tan26m). | Supported. |
| Figures kept as editable source (SVG or TikZ) with a code-aware critic | Liu26c; Gre26; Zha26aj; Sun26. | Supported. |
| Compile service on MiKTeX latexmk with SyncTeX, debounce, cancel-on-edit and page re-render by hash | Fast per-paragraph preview with background full compile (Lod26, engineering report); a cross-platform benchmark finds Tectonic the most portable engine (Ven26b), while the plan keeps Tectonic as an optional adapter. | Mostly tool documentation and design judgement. |
| Every template compiles in English and Russian, including Cyrillic classes | No post-July evidence on Cyrillic or bilingual templates. | Design judgement; template licences follow the LPPL (standard). |
| Page QA: user decisions tune advisory thresholds per template, and blocking checks never evolve | Fixed, sealed audits (Guo26) and evaluators kept out of the editable scope (Luo26c), by analogy. | Partly supported by analogy. |

### Memory

| Decision | Basis | Standing |
|---|---|---|
| A lossless, content-addressed log is the source of truth | Li26h; Zho26i; Rus26; Dan26; Scroll (arXiv:2608.21690); Yu26p; raw history enables repair after model changes (Doe26). | Supported. |
| zstd blobs with per-type dictionaries and patch deltas | Content addressing cuts storage 4.8-32.7x (Yu26p); the codec choice itself is untested. | Partly supported; codec details are a design judgement. |
| FTS5 BM25 per turn, exposed to seats as search tools with four controls | ReFind's four controls (Li26h); BM25 at scale (arXiv:2607.26497); BM25 as a strong baseline (Com26); hybrid fusion (Hat26). | Supported. Trigram and unicode61 settings for Cyrillic are a design judgement. |
| Links built lazily from real queries | arXiv:2608.21829. | Supported by one study. |
| An optional LLM-free hypergraph over rows, with verbatim content never broken into entities | EdgeMem (arXiv:2609.05553); LLM-free indexing (Xia26d); extracted graphs lose verbatim recall (Rus26). | Supported. |
| No entity graph as source of truth | Rus26; Zho26i; Doe26; curated notes erode (Zho26m). | Supported. |
| Deterministic valid_from, valid_to and supersedes columns | Yad26b; Zho26e; Xu26d; Wan26x; coarse invalidation suffices for current-state queries (Jia26h). | Supported. |
| Typed retention keeps rules, decisions and claims through compaction; scored pruning covers the rest | Zer26; Lia26c; pinned constraints (Li26ag); stale constraints (Nak26); pruning is safe (Rus26). | Supported. |
| A per-session profiler chooses views and writes schema.json, logged and reversible | Corpus-induced concepts (Lac26); unvalidated schema induction (Lod26b); only query-level routing is tested (Kur26). | Design judgement; no precedent. |
| Health gate and heartbeat | arXiv:2609.05510 (N=1, self-reported); independent oracles (Bha26). | Partly supported. |
| Claude Code importer keeps compaction epochs, redacts and puts nothing into prompts without a grant | Memory as an attack carrier (Zha26bb); exploit spread through memory (Pag26). | Partly supported; the epoch design is a design judgement. |
| Footprint reductions (compressor, caches, lazy imports) | Storage footprint as a metric (Yu26p). | Design judgement for the specific measures. |

### Prose engine

| Decision | Basis | Standing |
|---|---|---|
| Style panel with token entropy, lexical diversity and lexical density | Sha26j. | Supported. |
| Biber-style rates, hedges and boosters | Epistemic marker inventory (Wha26b); rhetorical marker categories (Ala26). | Partly supported; Biber-style rates themselves are background. |
| Excess vocabulary as population-level hints only | Hol26; For26; Sil26c. | Supported. |
| Academic Word List density reported as a confound | Kar26b. | Supported. |
| A banded "AI-style signal" with its evidence, never a verdict | Sha26j; Par26e; Kar26b; edit-extent bands with conservative calibration (Bao26c); calibrated abstention (Tho26); systematic review (Sha26e). | Supported. |
| Abstains out of domain, below 500 characters and on Russian until a calibration set exists | Out-of-domain failure (She26, Per26b, Dev26); Russian evidence is only adjacent (Kos26, Bog26). | Partly supported; the 500-character threshold and the Russian abstention are design judgements. |
| States known confounds: non-native, autistic and lightly edited writing | Non-native (Par26e); light edits (Kar26b). The autistic-writing confound rests on a 2025 work. | Partly supported; the autistic confound is background. |
| Never a rewrite target; the engine never optimises against a detector | Humanisation evades detection (Kar26b); out-of-distribution shifts defeat detectors (arXiv:2607.13565); edits move detectors in opposite directions (Par26e). | Supported. |
| A rule layer flags spans | No post-July source in this dossier. | Design judgement. |
| The seat returns line or span patches under registry locks, with excess edit distance tracked | PatchWrite (Yan26g); minimal edits (arXiv:2609.04061); claim-linked drafting (Hay26). | Supported. |
| Protected spans byte-identical; number and entity sets equal | Evidence locks (Yan26g); extractive compression keeps identifiers (Shi26f). | Supported. |
| Claim-strength lock: hedges, reporting verbs and scope markers may not move toward more certainty | Marker inventory from a tutorial (Wha26b); labelled stance survives compression (Kwo26); claim strength shifts between versions (Yin26c). | Partly supported; the lock rule is a design judgement built on that inventory. |
| Optional user-installed 0.5B model with a per-user LoRA adapter | Composite quality plateaus from 0.5B to 7B (Cha26c); claim preservation not measured there. | Partly supported. |
| Quality measured on a blinded set against the full-rewrite path | Blind raters and fault injection (Yan26g); claim-level audits (Hay26). | Supported as a method. |

### UI

| Decision | Basis | Standing |
|---|---|---|
| Claims coloured by verification density, never by author | arXiv:2609.03460 (idealised interface, d=1.82); ranked uncertainty targets (Mei26). | Partly supported: the effect was measured on an idealised interface. |
| An agent's own "done" is never shown as success; risk is computed outside the agent | Kum26i; Dub26; Pan26i; Hua26j; self-reported confidence can be worse than random for ranking (arXiv:2607.28317). | Supported. |
| Per-action approvals for consequential actions | Yan26y; step-level approval (Hri26); no single design fits all contexts (Bri26); agents mis-grant permissions (Che26ac); users do not avoid risky delegation (arXiv:2608.19551); active judgement (Mit26b). | Supported. |
| External risk signals, with deterministic gates for high-risk actions | Ali26f; Wan26aw; Dub26. | Supported. |
| Evidence drawer with a LEDGER-style trace; AgentGUI-style trace review | Kim26c (unevaluated); Zha26bt (38% faster); Wu26l; Gao26f. | Supported in part: AgentGUI is measured, LEDGER is not. |
| Blockprint neo-brutalist style on HeroUI v3: 2 px outlines, solid offsets, flat palettes, radius 0 | No post-July evidence on brutalist UI usability. | Design judgement, to be tested in our usability check. |
| Helper text of at most 90 characters, longer explanations in a popover | Single-focus views and progressive disclosure (Pel26b), by analogy. | Design judgement. |
| AA contrast test; a palette change is accepted only if contrast violations never increase | WCAG 2.2; verified repair accepts a change only if violations strictly decrease (arXiv:2608.24913), so the plan's rule is a weaker adaptation. | Standard plus adapted evidence. |
| RU/EN with Intl plurals, a Russian typograph, key parity and a 700 px pseudo-locale expansion test | CLDR plural rules; no post-July evidence on Russian UI localisation, text expansion or Cyrillic typography. | Standard plus design judgement. |
| HSE Sans as the main font, loaded locally with a fallback | No evidence; the licence gate is open. | Design judgement. |
| App icon in the continuous-corner shape | Apple Human Interface Guidelines. | Standard. |
| Own usability test of time-to-task and comprehension at 1280 and 700 px in both languages | Dense AI-generated UIs need testing with people (Var26b); attention and preference diverge (doi:10.3390/jemr19040089). | Supported as a method. |

## Standards and background (not evidence)

Nothing in this section counts as research evidence.

### Standards

- **WCAG 2.2**, normative for contrast and accessibility checks. WCAG 3 was still a draft
  in September 2026.
- **Unicode CLDR 49** (alpha in September 2026), for plural categories used through `Intl`.
- **MCP authorization specification, revision 2026-07-28**, for remote OAuth connectors.
- **Apple Human Interface Guidelines**, for the app icon shape.
- **LaTeX Project Public License (LPPL)**, for class and template licensing.

### Older works returned by the searches

These were first posted before 1 July 2026 and are background only.

- **Validation:** ScientistOne (2026-05-25); AI scientists produce results without
  reasoning scientifically (2026-04-20); SPOT (2025-05-17); Time to REFLECT (2026-05-18);
  ResearchClawBench (2026-05-28); Benchmarking Agentic Review Systems (2026-06-18); The Story
  is Not the Science (2026-02-05); BadScientist (2025-10-20); ReplicatorBench (2026-02-11);
  REPRO-Bench (2025-07-25); NatureBench (2026-06-23); MLR-Bench (2025-05-26); PaperBench
  (2025-04-02); Can Coding Agents Reproduce Findings in Computational Materials Science?
  (2026-05-01); Read the Paper, Write the Code (2026-04-23); sciwrite-lint (2026-04-09);
  FLAWS (2025-11-26); Paper Pilot (2026-06-17); ReproRepo (2026-06-16); CodeScientist
  (2025-03-20); Gaming the Judge (2026-01-21); Automatic Reviewers Fail to Detect Faulty
  Reasoning (2025-08-29); DeepSciVerify (2026-05-26); Rollout Cards (2026-05-12); CiteCheck
  (2026-05-26); ReportBench (2025-08-14); CLAIMCHECK (2025-03-27).
- **Visual QA:** PaperFit (2026-05-11); DiffSpot (2026-05-28); chart-plot (2026-06-08); VLM
  Judges Can Rank but Cannot Score (2026-04-28); VLM-SlideEval (2025-10-24); Paper2Poster
  (2025-05-27); SlideAudit (2025-08-05); visualization-guideline compliance with LVLMs
  (2025-06-24); Diagnosing Bottlenecks in Data Visualization Understanding (2025-10-02);
  PRISMM-Bench (2025-10-18); XBIDetective (2025-12-16); Judging the Judges on chart
  comprehension (2025-05-13); unsupervised slide quality assessment (2025-08-25).
- **LaTeX and documents:** Paper2Poster (2025-05-27); PaperDebugger (2025-12-02); LaTeX-FC
  (2025-11-12); i-LaTeX (2022-04-29).
- **Memory:** MEMTIER (first posted as arXiv:2605.03675 on 2026-05-05; the MDPI version of
  2026-07-22 is not its first posting); Fidelity Before Structure (2025-12-23); Zep
  (2025-01-20); LongMemEval (2024-10-14).
- **Prose:** The Misclassification of Autistic Writing as AI-Generated (published in LNCS on
  2025-07-15; the arXiv copy 2607.14729 of 2026-07-16 is not its first posting); Delving
  into LLM-assisted writing in biomedical publications (2024-06-11); GPT detectors are biased
  against non-native English writers (2023-04-06); Reducing Sequence Length by Predicting
  Edit Operations (2023); SynSciPass (2022-09-07); the Polish Ratio for ChatGPT-generated
  text (2023-07-21); LEWIS (2021-05-18); a corpus of sentence-level revisions on statement
  strength (2014-05-06).
- **UI:** PaperTrail (2026-02-24); yProv4DV (Crossref record created 2026-06-19, likely
  online before the cutoff); WaitGPT (2024-08-03); Interactive Debugging and Steering of
  Multi-Agent AI Systems (2025-03-03); Visual complexity of graphical user interfaces
  (2018-05-29); Keep it Simple (2020-04-21).

### Post-July items not used

- The validation search placed 22 post-July items below its relevance floor (r below 0.5):
  InternReviewer and InternAdvocate (2026-07-21); AutoSR (2026-08-17); ASI-Bench
  (2026-08-18); Rehearse (2026-07-30); LLMs in Peer Review at ICLR 2025 (2026-08-25); heterogeneous
  LLM refereeing panels (2026-08-27); A New Paradigm: Agentic AI for Scientific Discovery
  (2026-08-02); Systematic Literature Reviews With Two Multi-Agentic Systems (2026-07-24);
  AIMC (2026-08-10, used in the UI table); ASAREE (2026-08-27); DS@GT ARC at LongEval
  (2026-07-15); autonomous experimental design benchmark (2026-08-04); Long-Horizon
  Autonomous Architecture Research (2026-08-03); AgentTrails (2026-07-21, used in the UI
  table); AgentHPOBench (2026-07-31); The Evaluation Protocol Determines the Result
  (2026-08-10); Agent Safety Should Be a Runtime Contract (2026-08-11); Seraj
  (2026-08-20); The AI scientist arrives (2026-08-14); SourceMinds at CheckThat! 2026
  (2026-07-06); algorithm specification formats (2026-07-03); DSAgentBench (2026-08-11).
  Several of these dates come from Undermind and were not independently verified.
- Automated Laboratory Security Tiers (2026-07-15 per Crossref) qualifies by date but was
  omitted from the UI table as off-topic.

## Gaps and planned local evaluations

| Gap | Current evidence | Planned local evaluation |
|---|---|---|
| Harness evolution in a single-user desktop research tool with human approval | None; the nearest are benchmark studies (Esa26, Urs26b) | S5 gate: a tamper test showing the evolver cannot touch evaluators, plus regression, hidden and held-out gates. Proposed: compare each accepted change with a matched-budget baseline (Wan26ac). |
| Learned task routing | Thin and brittle under lexical shift (Vid26, Vid26b, Kum26g) | Proposed in S5: compare the router with a fixed-profile baseline on recorded missions, keeping a static fallback. |
| The L0-L5 ladder as a whole | No study evaluates a rung ladder | S6 test: agreement-only claims stay at or below L1. Proposed: a seeded-defect set in the style of CrossAudit. |
| Replication outside ML and tabular tasks | Nearly all replication evidence is from ML | None possible locally; L5 depends on independent implementations and attached lab results. |
| An end-to-end human visual sign-off workflow | No study | S8 test: the VLM cannot close a blocking issue; user sign-off at gates S0, S1, S4, S9 and S14. Proposed: equivariance probes for figures made from data (Kha26f). |
| Page-level TeX defects, Cyrillic and bilingual templates | No study | S9: every template compiles in EN and RU, and a test shows no out-of-target change. |
| Real-time compilation | One engineering report (Lod26) | S9: the 10k-line editor benchmark. Proposed: measure preview latency and the mylatexformat speedup. |
| Engine choice | One benchmark favouring Tectonic (Ven26b) | Proposed: record per-template compile success under MiKTeX and, if approved, under the Tectonic adapter. |
| Per-session schema profiler | No precedent | S11: benchmark against FTS5-only on our own sessions. |
| Low-RAM memory operation | Thin | S11: a before-and-after table for RSS, import time and disk. |
| Cyrillic lexical retrieval | Not studied | Proposed: include Russian sessions in the S11 benchmark. |
| Russian AI-style calibration | No post-July work on Russian scientific prose | Named blocked gate; the estimate abstains on Russian until a calibration set exists. |
| Compression-based detectors | None of the post-July items tests one | Not used, and no evaluation planned. |
| The autistic-writing confound | Only a 2025 work | Stated as a background confound; no local evaluation. |
| Claim preservation by the 0.5B rewriter | Not measured in Cha26c | S12: a blinded quality set against the full-rewrite path, with the strength lock and number and entity gates as tests; diagnosis under 20 ms at 20k characters. |
| Brutalist UI usability | No study | S14: our own time-to-task and comprehension test at 1280 and 700 px in both languages (named blocked gate: "brutalism usability, our own test only"). |
| Russian UI localisation, text expansion and Cyrillic typography | No study | S1: key-parity and 700 px pseudo-locale expansion tests; S14 usability in both languages. |
| Verification-density colouring in a working interface | Measured only on an idealised interface (arXiv:2609.03460) | Proposed: comprehension measures on claim cards within the S14 test. |
| Findings read from abstracts only | All rows above | Proposed: read the full texts of the load-bearing papers (PatchWrite, TeXFix-Bench, StarHarness, SEAL, CrossAudit, ReFind, Compaction Cliff, Provenance Density) before their slices; paywalled items come through the user's own session, with each download confirmed. |

### Additions suggested by the evidence but absent from the approved plan

- Compare every claimed harness improvement with a matched-budget baseline (Wan26ac).
- Hash each seat's full behavioural tuple (model, prompt, tools, configuration) into
  every ledger record (Aza26), and record which harness produced each result (Wha26).
- Freeze and report the verdict prompt for any review-based evidence (Ert26), and test
  rubric-based verdicts with counterfactual flips (arXiv:2609.02942).
- Add false-discovery control to the release gate when many hypotheses are tested (Lee26c).
- Do not order the approval queue by a seat's self-reported confidence (arXiv:2607.28317).
- Place each alarm beside its evidence and controls, and cap the motion speed of live
  displays (Rav26b, Ton26b).

## S0b addendum: motion, optical alignment, colour, type, logo vectorisation

Compiled on 25 September 2026 for the second S0 round: an animated frontend, text optically
centred in its boxes, non-intrusive colour, font presets that include caps-only and monospaced
faces, and a new logo round from GPT-Image rasters traced to SVG. The evidence rule is the one
above. Searches: Undermind quick searches in the "Arc Science 2026" workspace (no deep
searches) and the Firecrawl research index with a 1 July 2026 floor. The arXiv search tool
returned HTTP 406 and Semantic Scholar was rate-limited. Both indexes filter on created or
updated dates, so every date was re-checked: arXiv first postings from the export API
`<published>` field, with each abstract page opened, and DOI items from Crossref. Findings
are abstract-level claims.

| Topic | ID | Title | First posted | Finding | Decision it supports or constrains |
|---|---|---|---|---|---|
| Motion | [arXiv:2607.18507](https://arxiv.org/abs/2607.18507) | AInimation: Animating from Prompt to AI-Generated Responses | 2026-07-20 | Transitions that move prompt elements to their place in the response and highlight changes improved locating elements by 43%, identifying changes by 153% and verifying interpretation by 20%; the abstract gives no sample size. | Supports animating state changes that carry meaning (an item moving between lanes, a changed claim, a drawer opening from its trigger). Gives no duration or easing values. |
| Motion | [arXiv:2608.23609](https://arxiv.org/abs/2608.23609) | Decomposing Browser Pipeline Architectures for DOM-Sourced Particle Effects | 2026-08-21 | Worker offload raised Chrome pacing from about 52 to 144 FPS, but a 1.5-1.85x faster simulation kernel did not always raise user-visible FPS, and renderer rankings changed across browsers and GPUs. | Constrains claims of efficient animation: measure frame pacing end to end in the target WebView on the operator's hardware, not per-layer benchmarks. |
| Type | [doi:10.3390/jemr19040073](https://doi.org/10.3390/jemr19040073) | Effects of Pictogram and Typeface Complexity on Visual Attention: Eye-Tracking Study | 2026-07-07 (Crossref, online) | With 90 participants, reading time was the most sensitive measure; whether a serif or sans typeface read faster beside a simple pictogram depended on the thematic category, and subjective ratings did not differ. | Constrains font presets and mark-wordmark pairing: no general rule; judge pairs by measured reading or task time, not preference alone. |
| Type | [arXiv:2609.07029](https://arxiv.org/abs/2609.07029) | LoGAN: Multilingual Font Localization with Generative Agents | 2026-09-07 | An agentic pipeline extended a few glyphs of a font or logo to character sets in more than 27 languages with higher glyph fidelity and kerning consistency than general image editors (FLUX, Nano-Banana). | Indirect support for setting the "Arc Science" wordmark in a real font preset instead of taking lettering from generated images. Legibility was not measured. |
| Colour | [doi:10.1002/jsid.70094](https://doi.org/10.1002/jsid.70094) | Effects of Cognitive Load and Color Saliency Interaction on Children's Visual Search in Digital Interfaces | 2026-07-02 (Crossref, online) | In children's visual search, large colour differences (ΔE00) helped more under high cognitive load; red and green targets were found fastest, while blue and purple targets cost 50-60 ms. | Supports reserving strong colour contrast for critical states under load and keeping other colour quiet. Transfer from children to adult operators is an assumption. |
| Colour | [arXiv:2608.10169](https://arxiv.org/abs/2608.10169) | Predicting affective connotation of visualizations from their constituent colors | 2026-08-10 | Across three experiments, the emotional association of a whole visualisation was predicted by the mean association of its colours, and better by a mean weighted by the area each colour covers (to appear in IEEE TVCG). | Supports controlling colour by area share: large neutral surfaces set the tone, and a saturated accent on a small area shifts it little. |
| Logo | [arXiv:2609.25677](https://arxiv.org/abs/2609.25677) | Seeing Is Not Perceiving: When Synthetic Consumers Can and Cannot Pretest Visual Marketing | 2026-09-22 | In six preregistered visual marketing experiments (logos, packaging, advertising), no GPT-4o-mini or GPT-5.4-mini configuration reproduced more than two of six human effects, and one reversed a human effect. | Constrains logo selection: a model panel cannot stand in for the operator or a human panel. |
| Logo | [arXiv:2609.27110](https://arxiv.org/abs/2609.27110) | Feed the Panel Dimensions, Not Verdicts: Rubric-Decomposed Fusion of Vision-Language Aesthetic Judges | 2026-09-22 | Panels of holistic VLM aesthetic judges never significantly beat their best member; fusing scores on five rubric dimensions beat it on one of two datasets, at the cost of a few hundred human labels. | If a VLM pre-screens logo candidates, it scores fixed dimensions (silhouette, legibility at 16 px, stroke weight) and only filters; it does not rank the finalists. |
| Logo | [arXiv:2608.25876](https://arxiv.org/abs/2608.25876) | Do Vision-Language Models Agree on the Affective Qualities of Shape? | 2026-08-26 | Six VLMs agreed only partially on affective shape axes (mean rank correlation 0.36 against a 0.14 null and a 0.44 geometric ceiling), and agreement between models did not imply agreement with people. | Model adjectives such as "more minimal" or "more elegant" are not a selection criterion for marks. |
| Vector | [arXiv:2607.27699](https://arxiv.org/abs/2607.27699) | RefineSVG: Visual Feedback-Driven Reinforcement Learning for Image-to-SVG Generation | 2026-07-30 | Rendering a first SVG, computing a residual map against the target image and feeding it back for one correction step beat open-loop image-to-SVG baselines in fidelity, structural accuracy and code efficiency (ACM MM 2026). | Supports a render-and-compare gate: every traced logo is rasterised and compared with its source raster. |
| Vector | [arXiv:2608.28678](https://arxiv.org/abs/2608.28678) | Evaluating Constrained Iterative Refinement for Scalable Vector Graphics Generation with Off-the-Shelf VLMs | 2026-08-26 | Constrained decoding raised compile success, but iterative refinement exposed weak visual self-correction in general-purpose VLMs (two-page poster). | Constrains asking a chat model to "fix" SVG paths; keep deterministic tracing (VTracer) checked by an external metric. |
| Vector | [arXiv:2607.19056](https://arxiv.org/abs/2607.19056) | Vector-Bench: Can Models Surgically Edit SVG Code? | 2026-07-21 | Across 34 model endpoints and 40 repair tasks, the best reached 15.0% full specification success despite 43.7% mean repair progress. | Model edits to a final SVG need a check that nothing else changed; hand or deterministic edits are preferred. |
| Vector | [arXiv:2609.03806](https://arxiv.org/abs/2609.03806) | SVG-Score: Human-Aligned Evaluation of Text-to-SVG Generation | 2026-09-03 | CLIP-based scores barely reacted to wrong colours, counts and spatial relations; off-the-shelf VLM judges were more sensitive but uneven across error types and styles. | Rules out CLIP similarity as the vectorisation or logo metric. |
| Vector | [arXiv:2608.01977](https://arxiv.org/abs/2608.01977) | SVGEval: A Vision-Grounded Framework for Perceptual-Quality Benchmarking and Evaluation in Text-to-SVG Generation | 2026-08-03 | Multimodal models judged semantic alignment and aesthetics relatively well but struggled with geometry and layout (ECCV 2026). | Geometric fidelity is measured with pixel and edge metrics, not a VLM verdict. |
| Vector | [arXiv:2609.25270](https://arxiv.org/abs/2609.25270) | RULER: Instance-aware Rubric Rewards for SVG Generation | 2026-09-21 | A VLM judge prompted with a multi-axis rubric correlated with human judgements far better than CLIP or aesthetic scalars, which invited reward hacking when used as rewards. | Any automatic score of semantic or style quality uses a fixed rubric, never a scalar CLIP or aesthetic score. |
| Vector | [arXiv:2609.13294](https://arxiv.org/abs/2609.13294) | VectorHarness: Recovering Editable, Relation-Preserving Structure from Scientific Graphics | 2026-09-09 | Scores reconstruction on rendering fidelity together with raster fallback coverage and executable, relation-preserving edits, since visual resemblance alone can leave regions uneditable. | Acceptance of a traced logo includes editability: no embedded raster, few closed paths, shapes grouped by part. |
| Vector | [arXiv:2608.20803](https://arxiv.org/abs/2608.20803) | CubicSplat: Differentiable Vector Graphics via Error-Bounded Forward Relaxation | 2026-08-21 | A differentiable vector rasteriser gained over 2 dB PSNR in closed-fill reconstruction on DIV2K and Kodak and trained up to 4x faster (ECCV 2026 oral). | Reports fidelity as PSNR of the re-rendered image; optimisation-based vectorisation is an option if tracing leaves uneven curves. |

Already in this dossier and relevant here: Ton26b (presentation speeds above 8°/s raised
operator errors, so continuously moving content has a speed cap), Var26b (pixel complexity
metrics correlated only weakly with task outcomes, so a computed colourfulness or clutter score
is not a gate) and Rav26b (proximity-compatible layout).

### Implications for S0b

- **Motion.** Animate only changes that carry meaning, linking the old and new state
  (arXiv:2607.18507); cap the speed of continuous motion (Ton26b); under
  `prefers-reduced-motion` replace movement with an instant or opacity change (standard).
  Durations and easing are design judgement. Efficiency is verified by frame pacing in the
  real WebView (arXiv:2608.23609).
- **Optical centring.** No post-July evidence. Trim text to cap height and baseline with
  `text-box-trim` where supported, normalise preset metrics with `ascent-override` and
  `descent-override`, and verify the ink box in screenshots (standard plus design judgement).
- **Colour share.** Keep large surfaces neutral and put saturated colour on small areas,
  since whole-screen tone follows area share (arXiv:2608.10169); reserve strong contrast for
  critical states (doi:10.1002/jsid.70094, children). A numeric share limit is design
  judgement.
- **Logo.** Models do not choose the mark (arXiv:2609.25677, arXiv:2608.25876); a VLM
  pre-screen, if used, scores fixed rubric dimensions (arXiv:2609.27110). Simplicity for
  small sizes is design judgement, checked at 16, 24 and 32 px.
- **Vectorisation metric.** Re-render the SVG and compare with the source raster
  (arXiv:2607.27699) using pixel metrics (PSNR or filled-region IoU, arXiv:2608.20803), plus
  editability (path count, no embedded raster, arXiv:2609.13294). Not CLIP
  (arXiv:2609.03806), and no VLM verdict on geometry (arXiv:2608.01977).

### Gaps (design judgement)

- **Animation durations, easing and stagger** for a desktop tool: no post-July study gives
  values; arXiv:2607.18507 supports meaningful transitions only.
- **Reduced motion and vestibular sensitivity in 2D interfaces:** the post-July results
  returned are clinical or VR studies; the rule rests on the standards below.
- **Optical vertical centring of text in boxes and alignment of rectangles:** no study.
- **Legibility of caps-only and monospaced display faces, and Cyrillic-Latin pairing:** no
  post-July study; LoGAN generates glyphs but does not measure legibility.
- **A colour share threshold** (proportion of accent or saturated pixels): no study gives a
  number; arXiv:2608.10169 supports area weighting, not a limit.
- **Logo recognisability at small sizes and distinctiveness among app icons:** no post-July
  study; the logo and icon studies returned predate the cutoff.
- **A metric validated on tracing flat logos:** post-July metrics cover icons, illustrations,
  charts and scientific figures, not logos.
- **Brutalist motion** (hard offsets, press-down effects): no study.

### Standards and background (not evidence)

- **WCAG 2.2 SC 2.3.3 Animation from Interactions** (AAA): motion triggered by interaction can
  be disabled unless it is essential.
- **Media Queries Level 5, `prefers-reduced-motion`.**
- **CSS Inline Layout Level 3, `text-box-trim` and `text-box-edge`**, for trimming text to cap
  height and baseline.
- **CSS Fonts Level 5, `ascent-override`, `descent-override`, `line-gap-override`**, for
  normalising vertical metrics across font presets.
- **Older works returned by the searches** (dates as returned by Undermind or implied by the
  arXiv identifier, not re-checked): Design guidelines for animated data visualization based
  on perceptual capacity limits (2026-03-31); Design quality, distraction, and trust: web
  interface micro animations (2026-06-03); Counting the Wait (2026-02-04); Effects of Progress
  Bar Thickness on Users' Perception of Waiting Time (2026-06-07); Usability Hasn't Peaked
  (2026-04-13); Comparative Analysis of CSS Animation Methods under High DOM Load
  (2026-02-14); A Cross-Device and Cross-OS Benchmark of Modern Web Animation Systems (2026);
  Beyond Screenshots: VLMs' Understanding of UI Animations (arXiv:2604.26148); Assessment of
  newly designed fonts for visual accessibility (2026-03-24); Understanding the
  opaque-is-more and saturated-is-more biases for colormaps (2026-02-23); Well-known and
  Lesser-known logos with covert eye tracking (2026-05-09); Logo Placement and Centre Bias
  (2026-04-26); Adaptive Color Strategies in App Icons (2026-03-07); icon labels and style
  across cultures (2026-05-12); VFIG (arXiv:2603.24575); Render-in-the-Loop
  (arXiv:2604.20730); VectorArk (2026-05-23); Structural Evaluation Metrics for SVG Generation
  via Leave-One-Out Analysis (2026-04-09); random search versus iterative refinement for
  parametric icon design (2026-03-22).

### Excluded as unverified

- *Animations in UI microinteractions as modulators of emotion and time perception in UX*
  (doi:10.1016/j.displa.2026.103436): issue dated July 2026, but the Crossref record was
  created on 2026-03-17, so it was probably online before the cutoff; no abstract available.
- *The Effect of Hue Quantity and Contrast on Visual Search Performance in Complex Interfaces*
  (doi:10.1007/978-3-032-29593-4_2) and *The Impact of Icon Animation Types on Task
  Performance and User Experience* (doi:10.1007/978-3-032-29178-3_22): Crossref records created
  on 2026-07-07, but the abstract page needs a Springer login and neither Crossref nor OpenAlex
  holds an abstract.
- *Prediction of eyestrain and motion sickness based on eye parameters during exposure to a
  visual flicker stimulus* (doi:10.1016/j.actpsy.2026.107480): Crossref record created on
  2026-07-23; no abstract available.

### Post-July items not used

- Off-topic for logos (dates checked through the arXiv export API): Chart2SVG (2026-08-27),
  A Scalable Vector Graphics Latent Space (2026-08-22), CANVAS (2026-08-31), Compositional SVG
  Generation via VLM-Driven Hierarchical Semantic Parsing (2026-09-13).
- Dates not checked: LU-500, a logo benchmark for concept unlearning (arXiv:2607.24101);
  Learning to Detect UI Principle Violations via Reinforcement Learning (arXiv:2607.20690).
