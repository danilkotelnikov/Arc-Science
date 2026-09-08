---
title: Arc Science research architecture and qualification
date: 2026-09-05
release: 0.3.0
---

# Arc Science research architecture and qualification

Historical report: the `evidence-v0.3/` paths below are retained in the rendering companion checkpoint, not this lean source import. See [historical evidence locations](../../../docs/arc-science/historical-evidence.md). These results do not describe a fresh run of the current development branch.

Arc Science develops a scientific exploration loop around immutable inputs, competing hypotheses, bounded tools and recorded evidence. The 0.3 development scope strengthens evidence verification, connects rendered numerical figures to a visual critic, and adds an explicitly configured BioRender search path. Comparative scientific performance remains unmeasured.

## Investigation of the supplied package

The supplied 0.2.0 deployment archive contains a Python package, a FastAPI service, SQLite mission storage, direct OpenAI/Anthropic/OpenClaw adapters, a small numerical and public-source tool library, separate analyst/falsifier calls, deployment recipes and 137 tests. All 137 tests passed on Python 3.12.13 during this investigation. Earlier logs in `evidence-v0.2/` describe the previous authoring environment; current executed evidence belongs in `evidence-v0.3/`.

The most consequential reproduced gap concerns replay policy. A numerical receipt was replaced with a fabricated value, relabelled `replayable=false`, and exported with a fresh manifest. The original verifier returned `reproduction_passed=true` while treating that receipt as a source snapshot. The experiment is recorded in `evidence-v0.3/baseline-replay-bypass.json`. This demonstrates that checksum consistency alone did not enforce the claimed numerical reproduction boundary.

Two integration gaps also limited the existing loop. Tool parameter descriptions and provider argument schemas were maintained separately, allowing schema drift. The retained vision client and figure primitives were outside the exploratory mission workflow, so analyst/falsifier reconciliation did not itself establish that a vision model had inspected generated figures.

## Current research and architectural implications

### Frozen candidates and independently recorded review

Harness-of-Harness separates planning, implementation and assessment of frozen software candidates. Its within-run roles and runtime policy remain fixed; multimodal execution evidence supports QA. The proposed transfer to Arc is candidate-bound review and traceable evidence, with a separate regression process for changing the runtime. Its software experiments do not establish scientific accuracy for Arc. [HoH abstract](https://arxiv.org/abs/2609.01481), [full text, v1](https://arxiv.org/html/2609.01481v1).

### Protocol evolution

The official MCP specification inspected on 5 September 2026 identifies `2026-07-28` as the current revision. Requests carry version/capability context; discovery and response variants differ from the legacy initialization/session flow. An explicitly selected modern mode can coexist with a tested legacy mode. Provider support must be established separately. [MCP versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

MCP tool input schemas define the wire contract; optional Tasks add persistent handles for asynchronous work. Protocol annotations do not establish scientific trust or authorise metered actions. Durable external jobs require negotiated support and reconciliation before they belong in automatic mission resumption. [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview).

### Multi-agent scientific work

Anthropic's engineering account describes the value and resource cost of parallel research contexts, plus limits for tightly dependent tasks. Arc should assess reconciliation through matched-cost ablations rather than assume that additional seats improve results. [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system).

The Robin study integrates literature and computational agents with human experimental work. Reported weaknesses in citations and difficult bioinformatics questions make source checking and expert adjudication necessary evaluation dimensions. A successful workflow or model agreement cannot substitute for those checks. [A multi-agent system for automating scientific discovery](https://www.nature.com/articles/s41586-026-10652-y).

### Scientific systems used as comparison points

Kosmos combines a structured world model with iterative literature and data-analysis agents. Its preprint reports 79.4% statement accuracy under its scientific assessment, despite source-linked reports. For Arc, this supports an explicit distinction between traceable evidence and correct inference; it motivates claim-level evaluation alongside a persistent evidence graph. The metric is not transferable to Arc. [Kosmos, v2](https://arxiv.org/abs/2511.02824v2).

Google's May 2026 Co-Scientist account describes hypothesis generation, debate, ranking and evolution under an adaptive supervisor. These are relevant comparison points for Arc's hypothesis frontier. Arc currently preserves conflicting assessments rather than treating tournament rank as an acceptance criterion. Whether either selection strategy improves scientific outcomes belongs in a controlled evaluation. [Co-Scientist architecture](https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/).

### Native multimodal calls

OpenAI Responses accepts image input blocks containing data URLs, while Anthropic Messages accepts image blocks with base64 sources. Arc's visual review must transmit the exact bound artifact bytes through those formats and validate the resulting coverage. A configured model name is not evidence of its visual competence. [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision), [Anthropic vision](https://platform.claude.com/docs/en/build-with-claude/vision).

## Development design

| Component | Required behaviour | Evidence boundary |
|---|---|---|
| Tool catalog | One closed input schema per trusted tool; provider schemas derive permitted actions from the runtime catalog | Models select tools and arguments, while the runtime owns identity and policy |
| Replay verifier | Resolve deterministic versus snapshot policy from trusted identities; validate graph and receipt relationships | A receipt flag cannot exempt a numerical result from recomputation |
| Evidence graph | Explicit dataset, hypothesis, observation, assessment and artifact relationships; retained disagreements | A graph edge records a relationship, not the truth of a claim |
| Numerical figures | Deterministic fit/residual plots bound to frozen data and producer observations | Regeneration checks artifact consistency |
| Visual critic | Native image inputs, structured findings, exact digest coverage, reserved calls and next-round feedback | Visual adequacy remains separate from scientific validity |
| BioRender search | Public templates, separate credential, explicit enablement and pinned server catalog | Content is untrusted; search does not grant asset redistribution rights |

The data and tool boundaries support branching without a user-authored execution DAG. A model may open an alternative hypothesis, choose a discriminating registered action and revisit a prior route after contradictory evidence. It cannot change the frozen dataset, grant itself tools, revise the verifier or promote a scientific claim.

## Plugin and integration qualification

Superpowers supplies the development and independent-review workflow. HumanWriting and No AI Slop guide the technical prose. The connected BioRender app was exercised with public-template search. Browser inspection was attempted, but the browser environment blocked its connection to localhost; native HTTP checks run separately.

The BioRender capability check returned three structural-biology templates, including [Protein Homology Modeling](https://app.biorender.com/biorender-templates/details/t-62c743fda5cf881ed2d8695f?source=mcp). It confirms the connected app's search capability. It does not transfer the user's ChatGPT connection into a separately deployed Python service or establish that endpoint's MCP version. The official help describes user login, consent, search and credit-consuming figure creation without publishing a wire-version contract. [BioRender MCP connector help](https://help.biorender.com/hc/en-gb/articles/30870978672157-How-to-use-the-BioRender-MCP-connector).

Jinko, Boltz and specialised life-science tools become relevant when a mission supplies a mechanistic model, sequence, compound or dataset and defines the scientific calculation. This development increment does not launch such jobs or infer their outputs. Those adapters require their own input contracts, provenance, cost handling and domain validation before inclusion in the action catalog.

## Rendering qualification

Direct inspection covered the quadratic fixture and a 96-point regression with x values tightly clustered near 999900. The renderer uses the fit's normalized coordinates and every frozen measurement. It displays the expected residual scale and distinguishes narrow ranges with explicit offset labels. The original expanded coefficients would have introduced avoidable prediction error. Inspected PNGs and checksums are retained in `evidence-v0.3/figure-inspection.json`.

Image identity is scoped to the tested Pillow, bundled font, PNG/zlib and numerical environment. The verifier regenerates the PNG and rejects byte drift; it does not promise pixel identity across dependency or platform upgrades. Native provider payload tests establish exact transmitted image bytes under mocked transports. They do not establish live visual reasoning quality.

## Executed release qualification

The final implementation is commit `f351f1e894b70eb4c66365564f9cd5edd34dfc66`. Release evidence is consolidated in [`verification.json`](../evidence-v0.3/verification.json); the archive includes underlying logs, review findings, fixes and example capsules.

| Check | Executed result |
|---|---|
| Final source suite | 208 passed; no failures, errors or skips on Python 3.12.13 |
| Installed wheel | Version 0.3.0 in a separate environment without system site packages; inspected source, wheel and installed files match |
| Real HTTP service | Authentication enforced; fixture completed; three observations and two PNGs reproduced; 23 evidence nodes |
| Fresh-process replay | Two processes with different Python hash seeds produced identical scientific fingerprints and capsule bytes; tampering rejected |
| Required visual review | An unconfigured fixture vision seat stops at `needs_input`; contradictory adequate/blocking reports are rejected |
| Gallery regression | Targeted Node VM race reproduction passed after the fix; this is not a browser test |
| Independent review | All task findings addressed; whole-release blocker fixed and scoped re-review approved |

The wheel SHA-256 is `14266c50744d9b59699a6a643fceb4dc708cb9f45b58dcfa891aeec8bf516d70`. The installed checks ran outside the source checkout with `PYTHONPATH` unset. The retained first release pass had 204 tests and predates the final visual-adequacy fix; it is labelled as superseded development evidence.

These results qualify the tested software behaviour. Live text/vision providers and the raw BioRender endpoint remain unqualified. The browser environment blocked localhost access, so graphical interactions were not tested; the separate React build was not executed.

## Remaining qualification work

The runtime still requires independently executed scientific benchmarks. The adjacent [evaluation protocol](evaluation-protocol.md) defines baseline arms, artifact-level tests, repeated trials, source entailment, blinded expert assessment and resource accounting. It is a protocol, not a record of completed benchmark runs.

OAuth transaction/binding primitives remain available, but a complete deployed login, token-exchange and refresh service requires provider-specific integration and testing. Long-running MCP tasks, currency-denominated reservations, advanced Blender/MolecularNodes rendering, and broad omics workflows need separate qualified increments. The application remains one trusted laboratory service per data directory. Multi-tenant deployment and public exposure require a separate identity and isolation design.

The container recipes pin Python `3.13.15-slim-bookworm` and Node `22.23.2-bookworm-slim`, both listed by the official image catalogs on the inspection date. The containers have not been built or executed in this environment. Native qualification uses Python 3.12.13. [Official Python images](https://raw.githubusercontent.com/docker-library/official-images/master/library/python), [official Node images](https://raw.githubusercontent.com/docker-library/official-images/master/library/node).

Source snapshots, model records and hashes support traceability. Their integrity does not authenticate a remote scientific claim or replace independent measurements. Claims of state-of-the-art performance must wait for the comparative and replication evidence specified in the evaluation protocol.
