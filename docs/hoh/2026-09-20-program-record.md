# Program record — 20 September 2026

Development record and independent evaluation for each loop of the
[program](2026-09-20-program.md). Evaluator: Sol (GPT-5.6, read-only Codex sandbox,
shared working tree). Each row cites what was observed; nothing here is a validity,
novelty or production claim.

## Loop 1 — launch (`c97ddaf`, `577dddf`, `e98fb7d`)

Diagnosis: `Arc Science.exe` read its whole configuration from `ARC_DESKTOP_*`
environment variables that only the PowerShell launcher set, created no window until
the service was healthy, and reported failures on a stderr nobody saw; as a
console-subsystem binary a double-click also opened a terminal tab. With no launcher
it timed out silently.

Changes: the supervisor discovers the runtime (`init --auto`: Python 3.11+ resolved
to `sys.executable`, the package root, sibling components; contained, drained,
deadline-bounded probes), completes an older configuration (`discover --apply`, empty
fields only, `worker.python` never touched), prints a startup plan (`startup-plan`:
URL, serve arguments, readiness checks as JSON) and sets the worker's environment from
`worker.package_path` and `[components]` itself. The desktop is a windowed
application that attaches the parent console when a shell starts it; with no
launcher environment it finds the supervisor (explicit override honoured or refused,
sibling, development layout, PATH) and the workspace under the user's local
application data, opens its window at once with the starting page, runs
configuration and the service start on one thread, loads the workbench when the
health check answers, and shows any failure in the window and an owned native
dialog with the supervisor's redacted stderr tail. Navigation allows the inline
pages only until the workbench loads.

Checks: Rust 30 (supervisor) + 18 (desktop) tests, clippy `-D warnings` and rustfmt
clean; live: bare `Start-Process 'Arc Science.exe'` on the pre-existing workspace →
window in 0.4 s, no console, workbench loaded, clean exit with the port free;
`ARC_DESKTOP_SUPERVISOR` naming a missing file → dialog with that reason; a
configuration naming a missing interpreter → dialog with the supervisor's line; a
headless `--check-startup` from PowerShell → readiness verified, exit 0.

## Evaluation of loop 1 (Sol): changes required → addressed → accept

| Finding | Severity | Resolution |
| --- | --- | --- |
| Self-configuration still ran before the window existed, so a missing supervisor or bad configuration was silent again | high | Configuration and discovery moved to the start thread after the window exists; window creation failure itself shows a dialog |
| Probes were deadline-bounded but not tree- or pipe-safe; then the deadline stopped at leader exit | medium | Probes spawn in a job object / process group, drain stdout concurrently, kill the tree once the leader answered, and collect output under the deadline; a fixture with a stdout-inheriting descendant passes in 0.5 s |
| `discover --apply` replaced a bare `worker.python` | medium | Never touched; documented |
| `data:` navigation allowed at any time | medium | Allowed only until the workbench loads |
| Shown stderr could carry a credential | low | Redaction of bearer values, secret `name=value`/`name: value` pairs and long opaque tokens before display; test |
| Found during the fixes: the executable was a console-subsystem binary | — | Windowed subsystem with parent-console attachment; the launcher waits explicitly |
| `load_url` failure was stderr-only; a README sentence described the old order | low | Same failure page and dialog; README corrected |

## Loop 2 — UI and UX audit (`289ed5c`)

Every workspace was read in the browser and the native window. One operator-token
field in the header replaces five identical fields with five identical notes; the
version mark, the tagline and the navigation footnote are gone; each workspace keeps
one short boundary sentence (memory is evidence not instruction; rendering is not
validation; eligibility is not validation; reuse rights are not inferred; the rewrite
preserves scientific spans) and the repeated disclaimers, long empty states and
footers are removed. Sol: accept — the boundaries the HoH contract requires are still
stated once each.

## Loop 3 — settings (`97a07b5`, `f9a45aa`, `1247aa3`)

Design (Sol's recommendation of supervisor-mediated writes): `settings.toml` beside
`arc-science.toml` has one owner. The supervisor holds the typed schema (seats
planner/reviewer/falsifier/vision/prose with provider, model, effort, auth and a
credential name; providers with endpoint, CLI and the OpenClaw agent; MCP servers;
ACP agents; prose detection; Blender preset; viewer defaults), the validator (known
providers and efforts, identifiers, https or an exact loopback authority with a valid
port, OpenClaw isolation for every seat on it, unique names, stdio/http exclusivity)
and the writer (`settings replace --stdin --if-revision`: whole document, validated,
revision = SHA-256 of the file bytes, exclusive lock file around read/check/write,
atomic rename, status 3 when stale). The service reads through `settings show`,
forwards a replacement with the revision the operator saw (required at the HTTP
boundary, writers serialised) and maps 503/409/422; seats configured there drive the
model seats — the falsifier is now its own seat in both transports; credentials by
name live in `data/credentials/NAME.credential` written by `arc-science credential
--name NAME`, and a missing name is refused, never substituted. The snapshot says what
is applied live (seats, providers, prose detection) and what is stored for later
loops (effort, MCP, ACP, Blender, viewer); the Settings workspace edits the document,
saves with the revision and shows a stale save or an owner rejection verbatim.

Checks: Rust 10 settings tests (SHA-256 vectors, round trip, schema refusals, six
concurrent replacements → one success, deceptive loopbacks and ports); Python
`test_settings.py` 6 (stub supervisor with the same contract and the real binary,
credential store, seats → endpoints); vitest 3; Playwright spec through the real
supervisor (seats persisted, 409 stale, 422 invalid with the file unchanged); full
suites green.

## Evaluation of loop 3 (Sol): changes required → addressed → accept-with-findings

| Finding | Severity | Resolution |
| --- | --- | --- |
| Credentials by name did not match the CLI's store, and a missing custom name fell through to the planner's credential | high | One store, one path, ASCII names; a missing name is refused; readiness checks every seat's own reference, vision included |
| `if_revision` optional at the HTTP boundary; native read/check/write unlocked, so two writers could both pass | high | Revision required (422 without); exclusive lock file; service semaphore; six-thread test → exactly one success |
| Loopback check was a prefix match (`localhost.evil.example` passed) | high | Exact authority parse; port 1..65535; deceptive forms tested |
| "Applied live" claimed sections nothing consumed yet | medium | `applied_live` / `stored_pending` reported and shown; prose detection consumed |
| OpenClaw isolation enforced for the planner only | medium | Any seat on OpenClaw |
| Recorded hardening (not blocking): revisionless native replacement should be an explicit `--force`; the 30 s stale-lock takeover is not ownership-safe | watch | Recorded for a later loop |

## Loop 4 — seats and logins (`8b3802c`, `9568cac`)

Every seat (planner, reviewer, falsifier, vision) is its own transport. The CLI
transport generalises the Claude Code seat: Codex runs `codex exec` with the JSON
event stream, an output schema in the strict form the HTTP adapter sends, a read-only
sandbox, every acting feature switched off, the skills catalogue budgeted to nothing,
user config ignored and a private working root; Gemini CLI runs `gemini -p` in plan
mode behind a generated deny-all policy, extensions off, a system settings file that
switches hooks, skills, extensions and MCP off, and the seat instructions as the whole
system prompt. Both share the bounded runner (job object, drained pipes, deadline,
scrubbed environment, private directory). A Gemini `generateContent` adapter joins the
HTTP seats. Effort gains `xhigh` and is mapped per transport (Anthropic low–max; OpenAI
passed through for the model to accept; Gemini API minimal–high; Gemini CLI and
OpenClaw keep the provider default); a level a seat cannot express is refused when the
seat is built, and every call records requested effort, applied effort and its source.
Mixed transports run through a composite agent that dispatches by role; the whole route
is digested and bound to the mission at its first start, the worker runs on that
snapshot, and both resume paths refuse a changed route before writing anything. Codex
reports no model identity, so its seat records `requested_only` and the claim scope
never counts it as an independent reviewer (`unverified_identity`, derivation version
2). Capabilities report each CLI's login state; one consented probe per provider runs
every distinct seat; the Settings workspace shows connections and probe results.

Checks: Python 770 passed / 65 skipped (fake Codex and Gemini CLIs with the invocation
contracts, a mixed-seat live mission through the stub supervisor, route binding on both
resume paths); vitest 55; Playwright 19; Rust supervisor tests, clippy `-D warnings`,
rustfmt clean. Live on this workstation, through the production adapter under the
scrubbed environment: Codex (ChatGPT login, `gpt-5.5`, effort low) answered the
schema-valid probe, identity unverified, skills excluded, working directory removed;
Gemini CLI refused with `account_ineligible` (the individual tier is no longer served
by this client); Claude Code refused with `credit_exhausted`. None of these is a
validity claim; the two refusals are operator-side.

## Evaluation of loop 4 (Sol): changes required → addressed → accept-with-findings

| Finding | Severity | Resolution |
| --- | --- | --- |
| The bound plan omitted endpoint, executable, OpenClaw agent and auth style, was truncated, and the worker re-read the settings | high | Digest of the full route; `sha256:` prefix compared; the worker runs on the snapshot taken when scheduled |
| A declared change bypassed the binding; a paused start recorded the resume before the check | high | One `schedule` path for both: check, then record, then bind, then run; a refusal writes nothing |
| Rust allowed loopback OpenClaw endpoints, Python refused every non-https one | medium | `is_loopback_http` mirrors the native rule; applied to OpenClaw seats only |
| Missing live provenance failed open | medium | A live review without provenance is rejected, not recorded |
| Probe audit could store raw provider text | medium | Redaction of bearer values, secret pairs and opaque tokens before display or storage |
| Gemini id admitted `:` before the method path | low | Removed |
| Recorded design disagreement: Sol would treat the Codex "skills context budget" error item as a failure; the seat allows exactly that item because every run on a host with many skills emits it and the alternative puts operator skill text into the seat prompt | — | Allowed item is the only one; any other error item fails the call |
| Watch: `live_seats()` assembles the route from several settings reads; a concurrent replacement could mix revisions, though the assembled route is what is bound and run | low | Recorded for a later loop |

## Loops 6–7 — connectors: MCP servers and ACP agents (`68fbcc9`, `508d25b`, `8768da5`, `6735bc0`)

MCP servers from the settings run through the official `mcp` SDK (1.27.0, MIT,
modelcontextprotocol/python-sdk; optional extra `mcp`, exact pin; the Linux lock files
were not regenerated from this workstation). A server with consent opens one session
per mission — stdio in a private empty directory under the SDK's minimal environment
(the SDK contains the process tree in a job object on Windows), or streamable HTTP
without proxies or redirects — and its tools become planner tools `mcp_<server>_<tool>`.
A tool's input schema is tightened into the closed catalogue form: annotations are
dropped, every property is required, any assertion the catalogue cannot express or a
non-object top level withholds the tool with the reason listed. ACP agents are spoken
to over stdio with newline JSON-RPC (`initialize`, `session/new`, `session/prompt`); a
consented agent is one consultation tool. Arc grants no permission (the agent's own
reject option, else cancelled), serves no file or terminal, runs the agent under the
allowlisted environment and the kill-on-close job, serialises consultations per agent,
discards an agent whose prompt timed out, and says it cannot see the agent's own tools.
Every connector call is an external connector under the mission's egress consent,
bounded (blocks, text, structured content, image size, uri length, time), and its
observation is `claim_eligible: false`: the engine refuses a supporting assessment that
rests on it and the claim scope counts it as no test (derivation `arc-claim-scope-3`;
an earlier version is reported stale and derived again on verification; observations
recorded before the field existed read back as ineligible by their reserved prefix).
The consented connectors' identities join the seats in the route bound at a mission's
first start. The operator checks connections from the Settings workspace (`POST
/api/mcp/servers/check`, `/api/acp/agents/check`) without sending mission data.

Checks: Python 783 passed / 65 skipped (a FastMCP fake server and a fake ACP agent
with the invocation contracts; a live mission through the stub supervisor consulting
both; bounds; concurrency; the stale-scope path through `/verify`); vitest 56;
Playwright 19; Rust clean. Live on this workstation: PubMed (7 tools) and Context7
(2 tools) listed over streamable HTTP through the adapter; `arxiv-mcp-server` failed
inside its own package (an environment fault, not Arc's); `gemini --acp` answered
`initialize` (protocol 1, four auth methods). None of these is a validity claim.

## Evaluation of loops 6–7 (Sol): changes required ×3 → addressed → accept

| Finding | Severity | Resolution |
| --- | --- | --- |
| "Not evidence" was a label: connector observations could support an assessment and counted as successful tests | high | `Observation.claim_eligible`; the engine rejects support resting on it; the claim scope excludes it; derivation version 3 with stale handling and re-derivation on verify; legacy read-back by prefix |
| Connector authority was not mission-bound | high | Consented connector identities join the route digest; the worker runs on the bound snapshot; the whole route comes from one settings read |
| ACP inherited the service environment and killed only the leader | high | Allowlisted environment; kill-on-close job on Windows; own session group and `killpg` on POSIX (unverified on Linux here) |
| Concurrent consultations could cross-bind replies or start duplicate agents; a failed start leaked | high | Per-agent lock; start-once lock; failed starts closed; a timed-out prompt discards the agent |
| Dropped schema assertions widened tool inputs; a top-level union crashed | medium | Only annotations dropped; assertions withhold; non-object top level withheld |
| Structured content and images escaped the result bound | medium | Bounds on blocks, structured content, image size and uri length |
| Normalised ACP names could overwrite tools | medium | Collisions refused |
| Connection checks as GET; SDK range not reproducible | low | POST checks; `mcp==1.27.0` |
| `/verify` did not re-derive a stale scope | medium | Re-derived when absent or of an earlier version; API regression |
| Recorded gate: Linux process-group containment of ACP agents and the Linux lock files | gate | Unverified from this workstation |
