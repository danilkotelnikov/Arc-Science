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

## Loops 8–9 — viewer and live progress (`28cffee`, `d470b0b`, `3f43f1c`)

The Molecules workspace draws the operator's coordinates in Mol* (5.11, MIT), mounted
headless on one canvas and loaded as its own chunk (2.9 MB, 0.8 MB gzip) the first
time a structure is shown; the main bundle stays at 340 KB. A chosen file is drawn at
once from the browser's own copy, before any render exists and without a request; a
selected render's coordinates come from the authenticated `source` route bound to the
recorded digest, and an upload already shown is reused only when its SHA-256 equals
that digest, never by name. Representation, colouring, background, quality, assembly,
waters, contacts and spin are the viewer's settings, with defaults from the operator's
settings file (the `viewer` section is applied). Viewing needs no renderer, so the file
input is open whenever a token exists while rendering stays gated.

The job worker records each pipeline output the moment it appears (scene, render log,
composed figure, image checks) as typed stage records, named as observations, and
serves progress as server-sent events with resumable ids, a snapshot, the terminal
status and `end`; the workbench reads the stream with fetch and the token in a header,
resumes from the last id when a connection breaks, and polls when the service will not
stream. The scene is served while the job runs — parsed, bound to the uploaded source's
digest, marked provisional — and verified against the recorded artifact once complete,
so the viewer overlays the residue contacts while Blender still runs and says which
scene they came from. Saving a view downloads a blob: URL, the target the desktop shell
accepts. What the viewer shows is geometry, never validation.

Checks: Python 785 passed / 65 skipped (a staged fake pipeline: stage order and
timestamps, resume, bounded ids, provisional and verified scenes, source digest
binding, refusals); vitest 59 (stream parse, resume after a broken connection, refusal
→ polling; the workspace with a stubbed viewer); Playwright 20 (a nine-atom file drawn
under headless WebGL, settings changed, no request for the upload, a real blob:
download); live in the desktop browser pane: a synthetic two-chain file drawn on
upload, cartoon and surface, black background. Blender is not installed on this
workstation, so the live pipeline stream was exercised with the staged stand-in only.

## Evaluation of loops 8–9 (Sol): changes required ×2 → addressed → accept

| Finding | Severity | Resolution |
| --- | --- | --- |
| A saved render could be paired with a different upload of the same name | high | Reuse only when the upload's SHA-256 equals the recorded digest; the digest is stamped only on the very upload that was hashed |
| Provisional scenes were served unbound and after failure | medium | Parsed, bound to the source digest, served only while running or verified when complete, marked in a header |
| Stage names read as pipeline claims | medium | Observational labels; the viewer names the provisional or verified scene |
| The PNG download used a data: URI the desktop shell refuses | medium | Blob object URL, revoked after; verified as a real download |
| Stages were untyped; the stream could miss a wake-up; the resume id was unbounded | low | Typed records; waiter taken before reading state; id bounded to the stages that exist |
| A scene whose `source` was not an object returned 500 | medium | Checked before reading the digest |

## Loops 10–11 — catalogue and presets (`d27607d`, `666b596`, `8b32eda`, `d60b4f3`)

Nineteen named render presets live in one registry the API reports with its full
styles: the panel background of the composed figure, world strength, material finish,
partner colours, envelope tightness and stick radius. The rendered views keep their
transparent film and the figure its white canvas under every preset, so the reviewed
image checks hold. The pipeline writes the style beside the scene, hands it to the
Blender worker, which bounds every value again (tested for parity with the registry)
and records it in its receipt; the pipeline refuses a render whose receipt carries
another style; the manifest records preset and style. The operator's default comes
from the settings file (a name the registry does not know falls back to the registry
default and the capabilities say so), the render form offers the registry, and a
preset change of the same coordinates is derived as a presentation change — and a
change of scientific depiction as well when the two presets draw different meshes
(envelope isovalue, stick radius), with a narrower declaration refused.

The software catalogue names 101 structural-biology and cheminformatics packages by
category (14), licence and home, and probes each the way its presence can be observed
from this workstation: an isolated import in the service's interpreter, an executable
on PATH or in a versioned install folder, a conda environment or executable inside the
WSL bench, or the Claude Science daemon's own status. A probe reports presence only
for an import or an executable it observed; an environment or a daemon seen is
indirect evidence with its own count, an unavailable daemon observed nothing, and no
probe installs or qualifies anything. Probes run under the seat boundary (allowlisted
environment, private empty directory, bounded output drained with `os.read`, the whole
tree closed once the leader's status is known); a re-probe is an explicit POST; a
failed WSL listing is cached for the window; licence names are marked as recorded, to
be confirmed at the project home. The workbench lists the catalogue by category.

Checks: Python 790 passed / 65 skipped; vitest 60; Playwright 20. Live on this
workstation: 6 present (gemmi 0.7.5, Biopython 1.87, torch 2.11, scikit-learn 1.8,
ChimeraX 1.10 dev, Open Babel in WSL), 24 seen indirectly (sixteen WSL environments;
the Claude Science daemon installed, not running), Blender absent — so the worker's
style path was exercised only up to the renderer boundary (argv and `style.json`
asserted) and the live render under a preset remains an unverified gate.

## Evaluation of loops 10–11 (Sol): changes required ×3 → addressed → accept

| Finding | Severity | Resolution |
| --- | --- | --- |
| Opaque backgrounds would have failed the transparency check | high | Backgrounds colour the figure's panels; film and canvas unchanged |
| Advertised width/sample overrides were never applied | high | Removed from the contract |
| Every preset change was presentation, though two keys redraw the mesh | high | `geometry_changes` derives scientific depiction; narrower declarations refused |
| Probes inherited the service environment, buffered unbounded, killed only the leader; refresh on GET | high | Seat boundary, bounded drain, whole tree closed, POST refresh |
| An environment or daemon seen counted as the package present | medium | Indirect evidence with its own count; daemon state never implies absence; only the daemon's own entry reads its status |
| Shared WSL/daemon probes raced across four threads; a failed listing was retried per entry | medium | One lock; failures cached with a sentinel |
| Two notes contradicted their probes; an unavailable daemon counted as indirect | low/medium | Corrected |
| Recorded gate: no Blender here, so no render ran under a preset; licence rows not independently verified | gate | Unverified |

## Loop 12 — humane prose (`1a3a1f9`, `2625f9b`, `39aa447`)

The research digest (`docs/prose/humane-prose-2026-09-20.md`) reads the recent studies
and states what they support: detectors disagree by orders of magnitude on the same
human-written pages and move in opposite directions under the same professional edit
(Park, Jeong and Kim 2026, 135,389 manuscript pairs, read), misclassify non-native
writers (Liang et al. 2023) and fail under paraphrase (Sadasivan et al. 2023; RAID;
PADBen); style words rose in scientific abstracts after 2022 while syntactic variety
fell (Kobak et al. 2024, read); professional writers edit model prose into seven
categories with specificity the most valuable and the one a model cannot supply alone
(Chakrabarty, Laban and Wu 2024, LAMP, read — a corpus of literary fiction, travel,
food and personal-essay paragraphs, so the transfer to scientific prose is recorded as
an editorial judgement); readers' trust falls with perceived machine involvement. The
behaviour derived from it (`arc-humane-prose-2`, packaged as `humane-prose.md` and
installed as the `humane-prose` skill with a parity test) edits for the reader:
preserve every fact, number, citation and qualification; specificity first, then
redundant exposition, clichés, purple prose, structure, word choice, tense; a
scientific convention wins over a category; the corpora's style words used only when
exact; the author's voice kept and nothing added; a marked gap instead of an invented
fact; and a stated refusal to promise what any detector will say.

The Prose workspace gains local diagnostics that count what the corpora measured
(style words per thousand words, formulaic frames, sentence-length spread, repeated
openings, triplets, closing summaries) and name the writers' edit categories the
frames point at — the style-word density stays an observation, never a category on
its own — with a note beside every result that they are not an authorship estimate;
and a seat rewrite that sends the text, with per-request consent, to the prose seat
configured in the settings (CLI or API-key transport through one `structured()` call)
under the behaviour, verifies every protected span byte for byte or returns nothing,
requires the seat's provenance record, names the channel the behaviour travelled by
(Codex CLI has no system prompt), and writes an audit line with a keyed hash of the
text. An instruction that asks for detector evasion or impersonation is refused by the
service before any seat, consent or lock is involved, by a pattern that recognises
explicit requests (named detector products, AI-text detectors with an evasion or score
verb, "undetectable", "reads as human-written", hiding the traces of machine
generation, imitating a named person) and leaves the scientific words alone; an API
seat whose credential is not stored is refused as unavailable before consent, and the
capabilities say whether it is stored. A value whose unit an earlier protection class
claimed (4.2 nM) keeps its number protected (protection version 2).

Boundaries recorded in the digest (§5): the user's permission to take commercial
detector or "humanizer" internals was not used — every source is a public paper; the
request to prevent AI-writing detection is not promised and not attempted, because
the studies show no detector can be answered for honestly.

Checks: Python 796 passed / 65 skipped; vitest 62; Playwright 20. Live here through
the Codex seat (gpt-5.5, effort low, behaviour in the prompt): the sample lost its
stock frames and kept its hedge, its numbers, its residues and its citation, with six
marked gaps where the text had claimed without facts. Claude Code (credits) and
Gemini CLI (tier) seats remain unverified live; no API-key seat was exercised against
a real provider (mock transport only).

## Evaluation of loop 12 (Sol): changes required ×2 → addressed → accept-with-findings

| Finding | Severity | Resolution |
| --- | --- | --- |
| The rewrite called the CLI agents' private entry point; API-key prose seats could not answer | high | `structured()` on both transports; a mock-transport route test for an OpenAI Responses-shaped seat |
| The refusal of evasion instructions lived in the prompt alone | medium | Local pattern refusal before any text leaves; then moved ahead of seat resolution, consent and the lock, one audit record |
| The refusal pattern refused scientific "detection" and missed score, trace and imitation phrasings | medium | AI-text context required for generic terms; products, scores, traces, imitation of a named person recognised; documented as explicit requests, not every paraphrase |
| A missing API credential was answered as a provider rejection after an attempted line | medium | Credential preflight → 409 `seat_unavailable` before consent and audit; capabilities report stored/missing |
| Style-word density became an edit category by itself | medium | Observation only; frames indicate the category |
| The LAMP taxonomy was presented without its creative-writing domain | medium | Behaviour and digest name the corpus (§4.1) and call the transfer editorial |
| Audit-key failure was a 500; results did not say when the text changed | low | 409 `audit_key`; stale notices and behaviour toggle in the workspace |
| A product name refuses even an innocent instruction | medium (accepted, non-blocking) | Recorded as a conservative false refusal; the refusal names the phrase |
| Recorded gates: Claude and Gemini seats unverified live; no real API-key provider exercised | gate | Unverified |
