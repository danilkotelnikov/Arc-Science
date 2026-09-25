# S2 — lighter mission reads and derived route states: development record

Date: 25 September 2026. Plan: `C:\Users\danil\.claude\plans\replicated-cuddling-quail.md`, slice S2.
Research basis: [research dossier](2026-09-25-research-dossier.md) (UI section: claims coloured
by verification, routes derived from recorded events only).
Agents: Claude Code orchestration, one implementer, one independent reviewer; the four minor
review findings were applied by the orchestrator. Nothing here is a production or
scientific-validity claim.

## Objective, preserve, acceptance

- **Objective.** A Research poll must not move every image of a mission: the mission read
  returns artifact manifests, a cheap `head` read tells the client whether anything changed,
  and the claims read carries the derived state of each exploration route (focused, warm,
  parked) for the decision board of S4.
- **Preserve.** The artifact route (bytes and digest), capsule export and verify (formats 2
  and 3), the release decision and its checks, the claims payload used by the capsule,
  cancellation during a run, authentication on every mission route.
- **Acceptance.** GET mission under 5% of its previous bytes on a mission with 64 artifacts;
  capsule format 3 still verifies; route states never invent a state for a branch without
  recorded actions.

## Changes

- `service.py`: `GET /api/missions/{id}` returns `state.artifacts` as manifests (every field
  but `data_base64`); POST pause and POST cancel return the same projection through one
  helper, `manifest_view`. New `GET /api/missions/{id}/head` → `{id, revision, status, round}`
  (auth required, 404 for an unknown id). `/claims` computes `with_release` once and adds
  `routes`. The worker's cancellation check reads the status without parsing the state.
- `exploration/repository.py`: `head()` and `status()` read with SQLite `json_extract`;
  `list()` no longer parses every full state.
- `exploration/release.py`: `check_basis` reuses the subject digest the release evaluation
  already computed (it was computed five times per decision; output identical).
- `exploration/claims.py`: `route_states(state)`. Focused is the engine's recorded focus;
  warm is acted on in the last completed round (or the current one) or targeted by the
  current round's plan unless that plan stops; parked is two or more rounds without action;
  a branch with no recorded action and no targeting gets no route. `basis.rounds` counts
  every observation, `basis.evidence_ids` only successful, claim-eligible ones. Each route
  carries `source: 'derived'`.

## Measurements (implementer; FastAPI TestClient, 50 sequential polls of mission + claims)

| Mission state | GET mission before | after | 50 polls wall before | after |
|---|---|---|---|---|
| 64 rendered PNG artifacts, 1.98 MB stored | 1,979,443 B | 124,531 B | 18.21 s | 9.60 s |
| Near the 8 MiB state cap | 7,611,443 B | 124,531 B | 53.43 s | 28.75 s |

`/head` answers in about 14 ms (2 MB state) to 37 ms (7.6 MB), mostly client overhead. The
"64 images of about 1 MB" case in the plan cannot be stored: the repository refuses states
above 8 MiB.

## Verdict and checks

- Independent review: accept-with-findings, four minor findings, all applied: a stop plan
  targets nothing; the warm rule has no gap between warm and parked; `evidence_ids` excludes
  failed and connector observations; pause and cancel responses use the manifest projection.
  The reviewer's black-box run on a real service (temp data dir, port 8093): `/head` 401/404
  (including an SQL-injection-shaped id), manifest-only mission GET, artifact bytes matching
  the manifest digest, `/claims` routes, capsule verify, and a mid-run cancel with nothing
  committed afterwards.
- pytest: full suite after the fixes (see the commit trailer); the S2 files and the
  affected suites (`test_mission_reads`, `test_claims`, `test_visual_exploration`,
  `test_changes`) 42 passed.
- Not in this slice: the client still polls the full mission; S4a moves it to `/head`.
