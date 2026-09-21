# Agentic product increment — specification and acceptance matrix

Date: 21 September 2026. Agent: Claude Code, model `claude-opus-5`, session effort
`xhigh`, permission mode auto, ultracode orchestration on (recorded from the session
metadata; "Claude Opus Ultracode" is an orchestration mode, not a model identity).
Baseline at the start of this increment: HEAD `dcbe4be` (one commit after `af0529a`,
adding the [continuation prompt](2026-09-21-claude-agentic-ux-and-production-prompt.md),
the [native observations](2026-09-21-native-agentic-ui-observations.md) and gates A1–A8
in the [specification](specification.md)); working tree clean apart from the
unversioned `.omx/`; `native\arc-desktop\target\release\Arc Science.exe` SHA-256
`833CF5CBCB3528D68D806FE8147FB07F577B0FB0043C21DFD8403909460CADEC` (4,580,864 bytes),
which is the EXE the 20–21 September evidence was produced with. The Claude Science
environment at `http://127.0.0.1:8000` was unreachable at the time of writing, so the
comparison baseline the prompt asks for is **blocked**, not skipped.

This document is the plan record for the increment: what the source audit found,
which provider contracts were read, the design decisions an independent reviewer
challenged, the slices in order, and the acceptance matrix that later records will
fill in with observations. Nothing below is acceptance evidence.

## 1. Source audit (read-only, 21 September)

Eight read-only readers (separate Claude contexts) inventoried the source against
requirements A–H; a planner synthesised a gap matrix and slices; an adversarial critic
then refuted fifteen of the synthesis's claims by opening the cited files, and its
corrections are folded in here. Full reports: `.omx/artifacts/agentic-audit-20260921/`
(unversioned). The condensed matrix:

| Req. | What exists in source | What is wired to the UI | Gap (verified) |
| --- | --- | --- | --- |
| A first-run readiness | Supervisor-owned settings with revisions (`settings.rs`, `settings.py`); `/api/capabilities` reports live seats and CLI login state; `/api/session/status` proves the header | Settings loads only after the `Load settings` click; readiness words differ per surface (Settings: inactive/incomplete/not applied/…; Diagnostics: OK/Not checked/Locked/Unavailable/Not configured); Diagnostics tells a native session to "paste a token"; the save notice is a constant (`APPLIED` in `service.py`) | No shared vocabulary or owner of readiness; no autoload; "applies now" is not computed; stale-revision recovery is a raw sentence |
| B role/model selection | Five seats, provider/model/effort/auth/credential fields, per-transport effort table (`effort.py`), route snapshot bound at first start (`seats_bound` event with a digest), model identity as reported for CLI probes | Free-text model id, hard-coded enumerations in JSX, effort validity enforced in the UI only (the Rust owner accepts `gemini`+`max`), probes only for CLI seats of planner/reviewer/falsifier and only in memory | No versioned source-attributed catalog, no "custom id (unverified)", no capability fit, no per-role budget or fallback policy, silent seat inheritance (an empty reviewer runs the planner's model and shows "inactive") |
| C authentication | CLI transports for Claude Code / Codex / Gemini CLI with cost-free login state; API credential files written by `arc-science credential` with an owner-only DACL (`anchored.py`); an unwired PKCE helper (`oauth.py`) | Two auth labels; footnote says provider OAuth is unavailable | No Connect/Test/Disconnect; credentials cannot be stored, tested or removed from the app; `ARC_ANTHROPIC_AUTH=oauth` sends a file token as a Bearer with no official basis; custom endpoints accept any HTTPS host and would receive the credential |
| D permissions | Per-connector persistent `consent` boolean; per-mission `allow_egress`; engine refuses external tools without egress; ACP permission requests always refused; MCP `tools/call` and ACP `session/prompt` are implemented for consented connectors inside missions | Consent checkboxes in Settings; egress checkbox in Research | No grant record (destination, category, purpose, scope, expiry, source, last use, revocation), no receipts, no route or grant preview before start, revocation cannot reach a running mission, connector failures at start are not persisted |
| E cockpit | Persisted `MissionState` with events (kind/round/detail), observations, model records (live calls carry `transport` with started_at/duration/observed model), branches, changes; pause on restart; cancel; resume as a declared change | Overview, ledger, claim scope, branches, artifacts, last 15 events as text | No timestamps on events, no role/model/receipt per step, no operator pause or retry, model identity "as reported" never rendered, reopen loses the selection, mode (fixture vs live) invisible after completion |
| F claims | Claim scope per branch (requested wording, supported scope, uncertainty reasons, next tests), evidence graph with conflicts (`/evidence`), release ledger with six check states, replay capsule | Claim scope, ledger and verification are rendered; evidence graph is not | No retrieval time, method, digest, quality/independence, units or alternatives on a claim; ledger words are the raw enum; capsule lacks the ledger, graph, claims and receipts; Molecules/BioArt outputs have no admission path into evidence |
| G diagnostics | `/health` (public), `/api/capabilities`, memory health with capture status, MCP/ACP checks, native startup log and failure page | Cards with their own vocabulary; no probes, renderer, storage, failed jobs, package status, retry, open-log or copy-report | Host session ownership is known only to the native shell; nothing reports it to the page |
| H visual | One design system (20 September), stacked navigation at ≤ 760 px | Settings seats are a 7-column table that scrolls sideways at 700 px; the native window is resizable (not fixed at 1280×860 as one reader assumed) | No stacked seat card; no native narrow-width evidence; SR association of readiness with its row is positional only |

Contradictions the critic confirmed (fixed in the slices): the `/api/missions/route-preview`
path must be registered before `/api/missions/{mid}`; `sessionStorage` cannot restore a
selection across a window relaunch (only the persisted WebView profile's `localStorage`
can); a pre-running service cannot learn "reused" from an environment variable; a
directory mtime does not detect rewritten files; capsule v2 archives are pinned to
`__version__`; the settings revision check is mandatory only at the HTTP layer; the
synthesis's `service.py` line ranges overlapped between slices.

## 2. Provider contracts (official pages, read 21 September 2026)

| Provider | Mode | Official support | Basis | Arc today / plan |
| --- | --- | --- | --- | --- |
| Anthropic | API key (Console): `Authorization: Bearer sk-ant-api…` or legacy `x-api-key`; personal, service-account and legacy workspace keys with optional expiry | yes | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) | supported now (owner-only credential file) |
| Anthropic | Workload Identity Federation (`POST /v1/oauth/token`, IdP JWT) | yes, for servers/CI | [WIF reference](https://platform.claude.com/docs/en/manage-claude/wif-reference) | not a desktop end-user login; not planned |
| Anthropic | App Attest | yes, iOS/macOS only | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) | unavailable on Windows |
| Anthropic | Console OAuth profile written by the official `ant` CLI (`ant auth login`; `credentials/<profile>.json` with access/refresh token, mode 0600 under `%APPDATA%\Anthropic`; `ant auth status`; `ant auth print-credentials --access-token`; the SDKs and Claude Code read the same profile) | yes — "intended for local development and scripting on your own machine" | [CLI authentication](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/authentication), [WIF reference](https://platform.claude.com/docs/en/manage-claude/wif-reference) | `ant.exe` is installed on this machine; the official Python SDK is not. Plan: detect and report the profile as "Console profile via the external `ant` CLI"; do not extract its bearer token in this increment (reviewer advice: use the official SDK mechanism if ever added, and review the terms boundary separately) |
| Anthropic | Claude Code login (claude.ai subscription or Console) driven through `claude -p` | yes — Claude Code's own headless mode; `claude auth status --json` | [Claude Code authentication](https://code.claude.com/docs/en/authentication) | supported now; Arc never reads `.credentials.json`; `claude setup-token` is a Claude Code CI mechanism, not a third-party OAuth |
| Anthropic | In-app "Sign in with Claude" for a third-party Windows desktop app | no such flow is documented | [Authentication](https://platform.claude.com/docs/en/manage-claude/authentication) | **unavailable**; the UI says so |
| OpenAI | API key to the Responses API | yes | [API reference](https://developers.openai.com/api/reference/overview) | supported now |
| OpenAI | Codex CLI login (ChatGPT account via `codex login`, `codex login --with-api-key`, device code beta; `codex login status`) | yes — Codex's own login; "Use API key authentication for programmatic Codex CLI workflows" | [Codex auth](https://learn.chatgpt.com/docs/auth) (redirect target of developers.openai.com/codex/auth) | supported now via `codex exec`; Arc never reads `auth.json` |
| OpenAI | In-app "Sign in with ChatGPT" for third-party desktop apps | not documented | same page | **unavailable** |
| Google | Gemini API key (`x-goog-api-key`) | yes | [API key](https://ai.google.dev/gemini-api/docs/api-key) | supported now |
| Google | OAuth 2.0 desktop (installed-app) client with the operator's own Cloud project and `client_secret.json`; loopback redirect; scopes `cloud-platform`, `generative-language.retriever` | yes, documented as a testing-environment quickstart | [OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth) | Arc ships no Google OAuth client; **possible with an operator-supplied client, not in this build** |
| Google | Gemini CLI login (Sign in with Google / API key / Vertex) | yes — the CLI's own login; no status command | [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/) | supported now via `gemini -p`; the existence of `~/.gemini/oauth_creds.json` is evidence of a login, not of entitlement; Arc never reads it |
| OpenClaw Gateway | API credential to a loopback/HTTPS OpenResponses endpoint | project contract only | `apps/arc-science/docs/architecture.md` | supported now; reviewer isolation is operator-asserted, not verified |

Model catalog sources read the same day: [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
(`claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`: 1M context, 128K output,
vision, adaptive thinking, efforts low/medium/high/xhigh/max; `claude-haiku-4-5-20251001`:
200K/64K, vision, extended thinking, **effort not supported**), [Effort](https://platform.claude.com/docs/en/build-with-claude/effort),
[OpenAI models](https://developers.openai.com/api/docs/models) (`gpt-6-astra`
low/medium/high/xhigh/max — `none` returns 400; `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-5.6-luna` none/minimal/low/medium/high/xhigh/max per the [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning);
1.05M context, 128K output, image input), [Gemini models](https://ai.google.dev/gemini-api/docs/models)
and [thinking](https://ai.google.dev/gemini-api/docs/thinking) (`gemini-3.8-flash`,
`gemini-3.7-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`: thinking_level low/medium/high;
`gemini-3.6-flash`, `gemini-3.5-flash-lite`: minimal/low/medium/high; `gemini-3.1-pro-preview`
preview). The catalog file records the retrieval date and URL per entry; a model id
outside it is "custom (unverified)" and is never shown as ready because it parses.

## 3. Design decisions (challenged by Sol, GPT-5.6, thread `01a0c34d-4384-7f80-a298-fbe48efb12ff`)

The reviewer accepted the direction and rejected four parts of the first draft; the
decisions below are the corrected ones.

1. **Readiness is server-owned and passive.** `GET /api/readiness` returns one document
   with a stable machine `code`, `state` (`ready` / `not_tested` / `failed` / `blocked` /
   `unknown` — the implemented set; an earlier draft said `attention`),
   label, meaning, next action, `checked_at` and `source` per domain: session (kind
   native or token, from the request principal the auth dependency now returns),
   settings (revision, path, read-only), each seat (facts `configured`,
   `credential_stored`, `executable_detected`, `cli_logged_in`, catalog membership;
   verification `status`, `checked_at`, `subject_digest`), connectors, renderer, memory,
   storage. A GET never spends tokens or starts a connector; active checks stay behind
   explicit POST actions. A probe counts as current only when its subject digest
   (provider, endpoint origin, executable digest, model, effort, credential reference and
   generation) matches the seat now. The client readiness function in
   `SettingsWorkspace.jsx` and Diagnostics' own vocabulary are removed as authorities.
   `ready` is reserved for a verified operation (`use the protected local API`,
   `start a live mission with this seat`), never for "saved", "file present", "CLI
   logged in", "catalog id", "consented" or "Blender path exists".
2. **Save effects are computed from the changed paths.** Seats, providers, MCP and ACP
   apply to the next first start of a live mission (a bound mission keeps its route and
   a changed route blocks its resume with 409); the prose seat and the detection toggle
   apply to the next prose request; the Blender preset to the next render submission;
   viewer defaults are read only when the Molecules workspace's token changes, which the
   notice states as a limitation until that is changed. Nothing needs a restart today;
   `restart_required` stays empty and says why.
3. **Credentials never cross the WebView.** Storing a secret from page JavaScript is
   refused as a boundary: the page asks the native host, the host shows the Windows
   credential prompt (`CredUIPromptForWindowsCredentialsW`) and stores the secret in the
   Windows Credential Manager (`CredWriteW`, generic credential, per user, DPAPI) under
   `ArcScience/<name>`; the service resolves it by name (`CredReadW` via ctypes) after the
   existing credential file, which the `arc-science credential` CLI keeps writing for
   browser and non-Windows use. JavaScript receives only `{stored, name, provider}`.
   A credential is bound to a provider; the service sends it only to that provider's
   official origin unless the operator confirms a custom endpoint in Advanced.
   `ARC_ANTHROPIC_AUTH=oauth` is retired.
4. **Grants are approved, not derived.** Settings consent means "eligible to be asked";
   the exact grants (destination, data category, purpose, scope once/mission/persistent,
   expiry) are presented before the first start of a live mission, bound to the route
   digest and settings revision, and recorded append-only in SQLite
   (`grant_created`, `use_reserved`, `call_started`, `call_finished`, `grant_revoked`);
   a `once` grant is consumed transactionally. The engine's external-call path consults
   the ledger per call; revocation refuses the next call of a running mission and is
   recorded as a denied receipt and an event. A receipt describes an attempted dispatch;
   evidence admission is a separate later record. Connector text, memory passages and
   model output cannot create a grant (the ledger is written only by operator routes).
5. **Persisted events are not reinterpreted.** `Event` keeps its shape because change
   declarations bind to a digest of the event dumps (`changes.py`, `evidence.py`).
   Timeline rows (id, sequence, started_at, finished_at, role or deterministic worker,
   transport, requested and observed model, identity verified, receipt id, outcome,
   action and branch ids) go to a new append-only table written by the worker and are
   labelled operational, never evidence. Golden tests must show that pre-increment rows
   still verify, resume bindings still validate, load-append-save keeps the chain, and
   old capsules still import.
6. **Budgets are enforced or absent.** No `budget` or `fallback` field is stored until
   the engine reserves calls per role; the fixed "never fall back" behaviour is shown as
   a fact instead.
7. **The model catalog is data.** One JSON file (version, retrieval date, per-model
   source URL, capabilities, transports, efforts) is packaged with the service and served
   to the UI; Rust keeps the efforts-per-transport table it needs for `validate()` and a
   test pins the two tables equal.

## 4. Slices (each is one HoH loop: plan → develop → independent review → fix → gates)

| # | Slice | Objective | Preserve | Acceptance (observable) |
| --- | --- | --- | --- | --- |
| 1 | Readiness and first run | Shared vocabulary module; `/api/readiness`; Settings autoload on activation; server-computed save effects; Rust effort-per-transport validation; catalog-backed model picker with "custom (unverified)"; stacked seat cards at ≤ 700 px; Diagnostics and Research read the same readiness; no "paste a token" in a native session; live mode explains what is missing and links to the seat | Whole-document PUT with revision; Rust as the sole settings writer; credential names only; SESSION_COPY/LockNotice; existing 409/422/503 behaviour; MolecularWorkspace viewer defaults | Native fresh profile: Settings shows seats without a click and each seat shows one state with a cause; `gemini`+`cli`+`high` is refused by the supervisor; PUT changing only the viewer reports `changed=['viewer']` with its effect; Diagnostics agrees with the header; Research offline fixture is usable and live mode names the missing seat with a link; 700 px stacked cards without horizontal scroll (browser and native) |
| 2 | Native credential boundary and connections | Host-side credential prompt and Credential Manager store; `Test` = consented probe for API seats (planner/reviewer/falsifier/vision/prose) with persisted results; `Remove`; per-provider mode table from §2 with unavailable modes visibly blocked; `ant` profile detection (report only) | CLI credential entry; scrubbed subprocess environments; no secret in page state, URLs, logs or artifacts | Native: Connect opens the Windows prompt, the page state and DOM never contain the secret (Playwright watcher), Test records observed identity, Remove empties the store; browser mode shows the CLI instruction instead; an unavailable OAuth mode is labelled with its official basis |
| 3 | Grant ledger and mission grant preview | `grants.py` (SQLite, append-only); route preview registered before `/api/missions/{mid}`; grant approval at first start bound to the route digest; per-call ledger check in the worker; receipts; permission center in Settings; `Revoke`; MCP `tools/call` and ACP `session/prompt` receipts | Egress refusal without consent; default deny for unknown tools; seats_bound event; Observation shape | Deny → the call never reaches the connector (mock counter) and a denied receipt exists; allow once → one call then refusal; revoke during a running mission → next call refused and recorded; the preview digest equals the bound digest; a settings save after preview → 409 naming the revision |
| 4 | Cockpit and claims | Timeline table and route; pause; retry from error as a declared change; cancel with actor/time; reopen restores the selection (localStorage in the persisted profile, no secret); claim cards with evidence ids, method, digests, retrieval time, independence, units, alternatives, next test, stale-derivation marker; release words mapped (satisfied → passed, unknown → unverified, error → blocked, not_applicable → n/a) | Event model; reservation and commit order; MissionCancelled/RevisionConflict semantics; artifact and export gating | Offline mission: timeline rows for planner, tools, reconciliation and stop with ordered times; kill the service mid-mission → paused, `mission_interrupted`, interrupted row `outcome_unknown`; reopen → same mission; claim card fields present; a stale check blocks export |
| 5 | Export, diagnostics and recovery | Capsule format 3 (release, evidence graph, claims, timeline, grants) verified alongside v2; ledger-gated PNG download route; `/api/diagnostics` (storage integrity, failed jobs, renderer, package, probes) with retry, open-log and copy-redacted-report; host session ownership reported by the owned child's environment and shown as "unknown" for a reused service | v2 verification; `/health` public fields; redaction rules | Export of a verified mission has the new members and verifies; tampering the timeline fails the manifest but not numeric reproduction; a blocked mission's PNG download is refused; Diagnostics shows ownership, storage and renderer facts with sources |
| 6 | Native evidence and portable install | Versioned native journey driver and UIA download driver; acceptance script asserts release of processes and port and accepts the attach title; fresh-profile app-data override; failure-page clicks driven once; crash/reopen journey; clean-profile package check; CI builds the supervisor | e2e contract; launch modes; startup-log redaction | Journeys regenerate their report; the script fails on a leaked listener; the failure page's Retry and Open log are observed; a portable run's service path is under the package |

Ownership rule for editors inside a slice: disjoint files; `service.py` is split by
named regions with one owner per slice; `App.test.jsx` and `DiagnosticsWorkspace.jsx`
are owned by exactly one editor per slice.

## 5. Acceptance matrix (filled by the loop records)

States: verified (observed in the named artifact), failed (observed not to hold),
unverified (not yet exercised), blocked (an account, provider, runtime or reviewer is
missing; the blocker is named).

| ID | Requirement | State at start | Slice | Evidence column (to be filled) |
| --- | --- | --- | --- | --- |
| A1 | Fresh native profile: readiness loads without a ritual; fixture and live states distinct and consistent across Research, Settings, Diagnostics | unverified | 1 | verified for this build — [slice 1 record](2026-09-21-slice1-readiness-record.md), `.omx/artifacts/slice1-native-20260921/report.json` |
| A2 | Selectable, validated provider/model/effort/auth per role; capability fit; live readiness; the mission freezes its route; no silent substitution | unverified (route freeze exists: `seats_bound`) | 1, 2 | partly verified after slices 1–3 (catalog picker, unverified custom ids, effort intersection, supervisor refusal, persisted API-seat probes, the route snapshot carries its approved grants); budget and fallback remain open |
| A3 | CLI login, API credential and officially supported OAuth paths distinct, secure, testable, revocable; unavailable paths visibly blocked | unverified | 2 | partly verified after slice 2 — [record](2026-09-21-slice2-credentials-record.md): Test/Remove native, Store up to the Windows prompt (typed half needs a person), OAuth modes labelled with their basis |
| A4 | Grants with destination, category, scope, expiry, receipt; denied/revoked calls do not execute; memory/connector text cannot grant | unverified (egress refusal exists) | 3 | verified for this build with named gaps — [slice 3 record](2026-09-21-slice3-grants-record.md): preview, approval, receipts, revocation and the permission center native; connector text cannot grant (reviewer); expiry is in the ledger but not yet set or shown; no persistent grants yet |
| A5 | Cockpit from persisted events across restart, no hidden reasoning, no invented telemetry | unverified | 4 | verified for this build — [slice 4 record](2026-09-21-slice4-cockpit-record.md): timeline rows across a real service exit and a window relaunch (native), pause / retry / cancel with actor and time; `outcome_unknown` derived, running only from the status |
| A6 | Claims expose requested vs supported scope, support/refutation, provenance, uncertainty, findings, next test, ledger blockers | unverified (claim scope exists) | 4 | partly verified after slice 4 — claim cards with evidence method and digest, retrieval time, independence, findings, alternatives and conflicts, next tests, units (none recorded) and the stale marker; source quality grades and numeric uncertainty beyond the tools' own fields remain open |
| A7 | The actual EXE passes visible-control journeys for setup, permission, mission, claim and export at desktop and narrow sizes | unverified | each slice, 6 | partly verified after slices 1–6 — [slice 6 record](2026-09-21-native-evidence.md): one versioned driver regenerates the mission, reopen, diagnostics, startup-log, export, interruption and relaunch journeys on the desktop binary (exit 0, eleven journeys); setup (1) and permission (3) were driven by their slice scripts; narrow-size captures exist for slice 1 only; downloads go through the versioned UI Automation driver |
| A8 | Clean-profile package, security/failure paths, performance measurements and live probes before any production claim | unverified | 5, 6 | partly verified after slices 5–6 — package and storage facts, failure paths and the redacted report (5); the clean-profile package check of the bundled layout, the failure page's Retry and Open log, the fresh-profile app-data override and the acceptance script's release assertions (6); performance measurements and live probes on the operator's account remain; CI builds the supervisor by YAML only (not executed here); no production claim is made |
| J1 | Fresh profile: offline fixture usable; live mode explains the missing provider without tokens or a raw 401; Settings loads and shows what is inactive and why | unverified | 1 | verified for this build — native steps `research-live`, `settings-autoload`; Playwright `live mode … no 409` |
| J2 | Role configuration: valid combinations save and reopen; invalid ones fail before save; a mission captures the route; an unavailable provider has a recovery path | unverified | 1, 2 | partly verified after slice 1 — native `settings-saved`/`settings-reloaded`, cargo and e2e refusals; Connect/Test/Disconnect in slice 2 |
| J3 | Account paths: one supported credential path succeeds if the account permits, plus cancellation, expiry/quota, disconnect; other providers blocked/unverified with basis | unverified; live success depends on the operator's accounts | 2 | partly verified after slice 2 — invalid credential refused by the provider (401) and shown; disconnect (Remove) verified; success and prompt cancellation need the operator |
| J4 | Permission flow: exact intent shown; allow once, deny, revoke; denied calls do not occur; resumed calls carry a receipt; MCP `tools/call` and ACP `session/prompt` evidence or named blocker | unverified | 3 | partly verified after slice 3 — approve, refuse without approval, revoke mid-run and the denied receipt observed natively with MCP `tools/call` evidence (the fake server's call log); ACP is guarded by the same wrapper and previewed (pytest) but no ACP agent runs on this machine, so a guarded `session/prompt` is a named blocked gate |
| J5 | Mission: offline fixture and, if seats are usable, a consented live mission; steps, tools, budget, branches; cancel/resume/reopen; persisted events equal the UI | unverified | 4 | partly verified after slice 4 — offline fixture and a consented live mission on the local stand-in natively; cancel (e2e), pause / resume / reopen (native); the UI renders the persisted rows; a live mission on the operator's account not attempted |
| J6 | Claim review: support and contradiction, hashes, unsupported scope, next test; a stale/failed check blocks export; export and replay with limitations intact | unverified | 4, 5 | verified for this build after slices 4–5 — cards with support and contradiction, digests, unsupported scope and next tests; stale and unverified checks block the export and the PNG download; the format-3 archive exported from the real binary verified from disk with its limitations, informational tampering named without touching the replay |
| J7 | Cross-workspace: Memory links to a run; Molecules/BioArt outputs enter claims only through explicit admission; Prose keeps protected spans; Diagnostics agrees with the header; keyboard and 700 px | unverified | 1, 4, 5 | partly verified after slices 1, 4 and 5 — Diagnostics agrees with the header and with `/health` on the host session and names every fact's source; 700 px native and browser (slice 1); the last mission reopened from the profile; Memory's link to a run deferred (needs main.jsx); explicit admission of Molecules/BioArt outputs and Prose protected spans not re-verified in this programme |
| J8 | Security/failure: second origin, stale native session, redirect, untrusted text, missing renderer/provider, interrupted service, close/reopen; no credentials in URL/storage/logs | partly verified on 21 September (second origin, untrusted text, second window); redirect and stale secret unverified | 5, 6 | extended after slices 3–6 — the grant ledger and timeline hold digests only; an interrupted service and close/reopen verified natively and now regenerable from the versioned driver; the missing renderer named in Diagnostics; the redacted report carries neither token, bearer value, native secret nor home path; the failure page's recovery controls observed; every native run kept out of the operator's data by the app-data override |
| C0 | Comparison baseline against the Claude Science environment | blocked (unreachable at `127.0.0.1:8000`) | — | |

Nothing here is a production, novelty or scientific-validity claim.
