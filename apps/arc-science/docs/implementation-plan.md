# Arc Science core implementation plan

**Goal:** Deliver a testable scientific assurance core, real provider request adapters, a BioRender MCP connector and a reproducible Blender worker contract.

**Architecture:** Immutable candidates and a fail-closed governor sit outside model execution. The model layer sends raster views, not filesystem paths or text-only PDFs. A trusted broker supplies purpose-bound credentials. Numerical and geometry checks remain outside the model vote.

**Tech stack:** Python 3.11+, Pydantic 2, httpx, Pillow, JSON Schema; optional Gemmi and Blender.

**Spec:** `architecture.md` and the user's approved AEGIS/Polylogue/Atlas design, renamed Arc Science.

## Global constraints
- No model CLI or terminal sessions.
- No unverifiable completion or state-of-the-art performance claims.
- Missing, stale, expired, inapplicable or malformed review evidence blocks acceptance.
- Provider and BioRender credentials remain separate; no external authentication is implied by this package.
- Fail closed on transport errors and on unknown endpoint/tool schemas.
- The complete old repository and alleged patch are not available locally; this is a new isolated core, not a verified upgrade of the whole repository.

## Task 1: Evidence, contracts and governor
Files: `contracts.py`, `store.py`, `governor.py`, `tests/test_core.py`.
Interfaces: `ArtifactStore.put/read`, `Candidate.digest`, `assess`, `EventLedger.append/verify`.
Test stale candidate, empty evidence, wrong source, missing reviewer, self-review, unknown criteria, expired qualification and event conflicts before implementation.
Run: `python -m pytest tests/test_core.py -q`.
Acceptance example: `assert not assess(candidate, seats, reviews, (), now=NOW).eligible`.

## Task 2: Direct model transport and independent review
Files: `transport.py`, `harness.py`, `tests/test_transport.py`.
Interfaces: `AccessGrant.require`, `VisionClient.review`, `review_candidate`.
Test actual outgoing image bytes, subject/project/resource binding, disallowed redirects, truncated responses and independent request envelopes with httpx's in-memory transport.
Run: `python -m pytest tests/test_transport.py -q`.

## Task 3: BioRender and OAuth handoff
Files: `oauth.py`, `biorender.py`, `config/mcp.json`, `tests/test_connectors.py`.
Interfaces: `OAuthTransactions.begin/consume`, `BioRenderClient.discover/call`.
Test PKCE/state replay and principal binding; initialize MCP; discover and pin schemas; validate every call; block paid/draft actions without explicit approval.
Run: `python -m pytest tests/test_connectors.py -q`.

## Task 4: Reproducible scene and Blender job
Files: `scene.py`, `workers/blender_worker.py`, `tests/test_scene.py`.
Interfaces: `prepare_atomic_scene`, `BlenderJob.argv`, `audit_layout`.
Test mmCIF/PDB identity selection, input hash binding, missing ligand rejection, collision checks and safe batch invocation. Compile Blender script; do not claim a render without Blender.
Run: `python -m pytest tests/test_scene.py -q`.

## Task 5: Frontier, context and evolution guards
Files: `planning.py`, `tests/test_planning.py`.
Interfaces: `ResearchGraph.frontier/invalidate/compile_context`, `EvolutionCandidate.can_activate`.
Test dependency cycles, alternatives surviving failure, read/write conflicts, hard token limits preserving contradictory evidence, budget bounds and prohibition on same-run evolution.
Run: `python -m pytest tests/test_planning.py -q`.

## Verification
Save raw red/green logs. Run the entire new-core suite, compileall and git diff --check. Export a checksummed archive only from files confirmed on disk. Report mocked network tests separately from live integrations.

## Task 6: Bounded artifact improvement
Files: `improvement.py`, `tests/test_improvement.py`.
Interfaces: `RevisionPlan`, `improve`.
Test new candidate retesting, repeated-candidate rejection, fixed project/policy/source boundaries, missing evaluator evidence and exhausted budgets.
Run: `python -m pytest tests/test_improvement.py -q`.
The production runtime must isolate builder and evaluator permissions; Python callable separation alone is not a sandbox.

## Adversarial review additions
Regressions caught and corrected during local review: atomwise alternate-conformation mixing; mechanical checks bound only to an image rather than the entire candidate; missing semantic caption expectations in VLM requests. Source-level peer review by a separate human or external model remains outstanding.
