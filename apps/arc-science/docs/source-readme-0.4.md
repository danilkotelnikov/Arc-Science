# Arc Science 0.4.0

Arc Science is a local scientific exploration service. A configured model proposes competing hypotheses and registered tool actions; analyst and falsifier roles review the same frozen evidence independently. The next round can open alternatives, revisit a route or stop with missing information. The runtime owns inputs, tool contracts, permissions, budgets and verification.

This release adds authorized SVG/PDF intake, flat source proofs and Blender/Cycles figure rendering with portable run records. It builds on trusted numerical replay, schema-derived model actions, a queryable evidence graph, image-bound visual review and constrained BioRender template search. Comparative scientific performance has not yet been measured. See the [rendering guide](docs/vector-rendering.md), [prior investigation](docs/research-and-validation.md) and [evaluation protocol](docs/evaluation-protocol.md).

## Native installation

Current native qualification uses Linux and Python 3.12.13. The package declares Python 3.11+; other Python versions and platforms require their own qualification. Dependencies are pinned, but not vendored.

```bash
cd arc-science
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock
python -m pip install --no-deps dist/arc_science-0.4.0-py3-none-any.whl
arc-science validate --output reproducibility.json
arc-science serve --data ./data-v0.4
```

Open `http://127.0.0.1:8080/diagnostics`. In another terminal, activate the same environment and run:

```bash
arc-science token --data ./data-v0.4
```

Paste that operator token into the console. It stays in page memory. Select **Offline validation fixture**, then **Create and start**. The fixture uses a labelled scripted planner and actual numerical computations; it produces no live-model or biological evidence. The native wheel includes this diagnostic console. The separate React/HeroUI source is in `web/`.

Use a fresh data directory for 0.4.0. Research capsules bind their runtime version and require a matching verifier. Preserve previous data and its matching deployment; read [migration notes](docs/migration-0.4.md) before upgrading.

## Direct model and vision configuration

Live execution requires an exact model ID, a server-side credential and mission egress consent. Calls use native HTTP. No model CLI or terminal session is involved.

```bash
arc-science credential --name planner --data ./data-v0.4
export ARC_PROVIDER=openai
export ARC_MODEL='YOUR_EXACT_MODEL_ID'
export ARC_MODEL_TOKEN_FILE="$PWD/data-v0.4/planner.token"
export ARC_PUBLIC_READS=1
arc-science serve --data ./data-v0.4
```

For Anthropic, set `ARC_PROVIDER=anthropic`. The native endpoint is selected automatically. Reviewer settings `ARC_REVIEWER_PROVIDER`, `ARC_REVIEWER_MODEL`, `ARC_REVIEWER_URL` and `ARC_REVIEWER_TOKEN_FILE` inherit planner values when empty. Isolated roles using the same model are not empirically independent models.

Numerical missions generate bound PNG figures without a vision provider. To require visual review, configure `ARC_VISION_PROVIDER`, `ARC_VISION_MODEL`, optionally `ARC_VISION_URL`, and `ARC_VISION_TOKEN_FILE`; then select the console's visual-review option or send `"vision_review": true` in the mission request. There is no default vision model ID. A separate credential can be stored with `arc-science credential --name vision --data ./data-v0.4`; an empty vision token setting inherits the reviewer credential.

The critic receives actual image bytes through OpenAI or Anthropic image blocks. Its structured report must cover the exact submitted digests and frozen candidate. Missing, failed, uncertain or unresolved visual review prevents a required-review mission from completing. Findings feed the next planning round. Visual adequacy does not establish scientific validity.

Provider refusals, malformed responses, wrong observed model IDs and authorization errors do not fall back to the fixture. Credentials and endpoint selection stay outside model-controlled arguments. OpenClaw requires a configured HTTPS endpoint, an isolated agent and `ARC_OPENCLAW_ISOLATED=1`; downstream isolation still requires operator qualification.

## BioRender search

BioRender search is separately enabled and credentialed. The deployed service does not inherit the user's connected ChatGPT app credentials.

```bash
arc-science credential --name biorender --data ./data-v0.4
export ARC_BIORENDER_TOKEN_FILE="$PWD/data-v0.4/biorender.token"
export ARC_BIORENDER_PROTOCOL=2025-11-25
arc-science biorender-discover
# Review the discovered contract, then copy its schema digest:
export ARC_BIORENDER_SCHEMA_DIGEST='REVIEWED_SCHEMA_DIGEST'
export ARC_BIORENDER_READS=1
```

The mission tool accepts only a bounded query. The operator chooses the fixed endpoint and protocol; the adapter fixes public templates, omits thumbnails and checks the discovered schema against the configured pin before exposing search. Results retain source links and provenance. Asset licence status remains unverified.

Legacy MCP `2025-11-25` and explicit `2026-07-28` request/response modes are implemented separately. No automatic version downgrade is used. The connected BioRender app returned public search results during this investigation; the raw deployed endpoint has not been qualified with either mode. Metered figure generation, private-file search and asynchronous MCP tasks are outside this mission adapter.

## Vector figures and Blender

The operator CLI accepts authorized SVG or single-page PDF exports, retains their original bytes and creates a verified flat proof. BioRender public search supplies template links; the connected operation does not supply vector downloads. Export completed artwork through an authorized account and keep its source and permission record.

```bash
python -m pip install -r requirements-vector.lock
arc-science figure-import examples/vector-rendering/source/response-fixture.svg \
  --project ./figure-project \
  --provenance-file examples/vector-rendering/source/provenance.json
```

Use the returned asset manifest with `figure-render`. The [rendering guide](docs/vector-rendering.md) covers the separate Blender environment, `studio` and `flat` styles, and `figure-verify`. Runs retain the source, job settings, logs, a packed `.blend` scene and a receipt binding the output hashes. The styled PNG is an intact raster presentation of the vector proof. The editable SVG/PDF remains a separate file.

The included artwork is an original synthetic fixture. BioRender vector export and comparative scientific quality are not established by that demonstration.

## Evidence and recovery

The installed tool catalog contains `describe_data`, `polynomial_fit` and `permutation_control`; optional tools add Europe PMC literature search, RCSB metadata and BioRender public-template search. Each adapter has a closed input schema and trusted execution/replay policy. Models cannot install tools, select credentials, alter replay classification or execute arbitrary code.

The evidence graph links the frozen dataset, hypotheses, observations, producers, assessments and visual artifacts. Reviewer contexts are bound to stored evidence. Contradictory findings remain visible. Graph edges record relationships, not truth scores.

SQLite atomically stores snapshots and hash-chained receipts. Optimistic revisions reject stale writers, idempotency keys prevent duplicate creation, and cancellation fences later commits. Interrupted missions become paused and need an explicit resume. Model calls are reserved before dispatch and interrupted calls remain conservatively charged. External execution is not exactly once; adding a paid or mutating adapter requires a separate reconciliation design.

Default limits are five rounds, twelve branches, twenty actions, twenty-four model-role calls and three concurrent tools. Call and output limits are not a currency spending guarantee. Figures have explicit byte/count bounds; text-model contexts contain artifact manifests rather than image bytes.

## Verification

```bash
arc-science fixture --output ./fixture-output
arc-science verify ./fixture-output/capsule.zip
arc-science validate --output ./reproducibility.json
python -m pip install -r requirements-test.lock
python -m pytest -q
```

Capsules contain frozen inputs, action receipts, recorded model outputs, context digests, figure bytes and runtime metadata. The verifier recomputes trusted numerical tools and regenerates figures. A receipt cannot turn a numerical computation into a snapshot by changing a flag. Public reads remain snapshots; verification does not requery changing databases or rerun language models.

`validate` uses fresh Python processes with different hash seeds to compare scientific fingerprints and capsule bytes, then checks tamper rejection. The executed release record is in `evidence-v0.4/verification.json`; earlier evidence directories are historical. Local hashes are not external signatures, and `completed` is a workflow status rather than scientific validation.

## Deployment and API

```bash
cp .env.example .env
docker compose up --build -d
# API/diagnostic console without the React build:
docker compose -f compose.yaml -f compose.api.yaml up --build -d
```

The recipes publish on loopback and use a non-root service, persistent volume and read-only root filesystem. Run one worker per data directory within one trusted laboratory. Docker images and the React build were not executed in this environment. Blender rendering has a separate qualification record under `evidence-v0.4/`. Full browser qualification was blocked by the managed browser's localhost policy. Native HTTP checks are recorded separately.

Every `/api` route requires `Authorization: Bearer <operator token>`. `/health` contains no research data.

| Route | Purpose |
|---|---|
| `POST /api/missions` | Create; optional `Idempotency-Key` header |
| `GET /api/missions` | List mission summaries |
| `GET /api/missions/{id}` | Inspect stored state |
| `POST /api/missions/{id}/start` | Start or explicitly resume |
| `POST /api/missions/{id}/cancel` | Cancel and fence future results |
| `GET /api/missions/{id}/evidence` | Read the bound evidence graph |
| `GET /api/missions/{id}/artifacts/{digest}` | Fetch an authenticated PNG |
| `GET /api/missions/{id}/capsule` | Export a frozen capsule |
| `GET /api/missions/{id}/verify` | Check history and recompute evidence |
| `GET /api/capabilities` | Inspect configured capabilities |

For a numerical live mission, send `points` as 8–2000 x/y measurements. This small synthetic example shows the request shape; replace it with your frozen data. It requires the model and vision configuration above.

```json
{
  "goal": "Compare explanations for this synthetic response",
  "mode": "live",
  "allow_egress": true,
  "vision_review": true,
  "points": [
    {"x": 0, "y": 1}, {"x": 1, "y": 2},
    {"x": 2, "y": 5}, {"x": 3, "y": 10},
    {"x": 4, "y": 17}, {"x": 5, "y": 26},
    {"x": 6, "y": 37}, {"x": 7, "y": 50}
  ]
}
```

The API accepts measurements directly; the React console also has a measurement JSON field. The native diagnostic console's form currently starts goal-only missions, including the supplied offline fixture.

## Remaining scientific and integration work

OAuth binding and PKCE primitives remain available, but a deployed browser login, token exchange and refresh service still needs provider integration. The molecular Blender worker remains a basic atomic/C-alpha adapter; the new vector figure worker preserves 2D artwork on a styled panel. Domain-specific omics, mechanistic models, molecular design, new geometry adapters and long-running jobs need their own validated tool contracts and datasets.

The [evaluation protocol](docs/evaluation-protocol.md) specifies held-out tasks, matched-resource baselines, blinded expert review and replication. Those measurements are required before describing Arc as state of the art. The runtime never grants publication eligibility.
